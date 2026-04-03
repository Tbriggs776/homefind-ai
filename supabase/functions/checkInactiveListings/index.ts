import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const MAX_EXECUTION_MS = 25000;
const BATCH_SIZE = 20;
const FETCH_TIMEOUT_MS = 8000;

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startTime = Date.now();
    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user && user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return jsonResponse({ error: 'Spark API credentials not configured' }, 500);
        }

        const cursorKey = 'inactive_check_cursor';
        const { data: cursorArr } = await admin
            .from('sync_cache')
            .select('*')
            .eq('sync_key', cursorKey);

        const lastCheckedDate = (cursorArr?.[0]?.cached_data?.last_checked_date as string) || '2000-01-01T00:00:00Z';

        let { data: activeProperties } = await admin
            .from('properties')
            .select('*')
            .eq('listing_source', 'flexmls_idx')
            .eq('status', 'active')
            .order('updated_at', { ascending: true })
            .limit(BATCH_SIZE);

        let properties = activeProperties || [];
        if (properties.length === 0) {
            const { data: p } = await admin
                .from('properties')
                .select('*')
                .eq('listing_source', 'flexmls_idx')
                .eq('status', 'active')
                .order('updated_at', { ascending: true })
                .limit(BATCH_SIZE);
            properties = p || [];
        }

        if (properties.length === 0) {
            return jsonResponse({ success: true, message: 'No active properties to check', checked: 0, marked_inactive: 0 });
        }

        let markedInactive = 0;
        let checkedCount = 0;
        let lastProcessedDate = lastCheckedDate;

        for (const property of properties) {
            if (Date.now() - startTime > MAX_EXECUTION_MS) {
                console.log(`Time guard hit after ${Date.now() - startTime}ms`);
                break;
            }

            if (!property.external_listing_id) continue;

            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

                const response = await fetch(`https://replication.sparkapi.com/v1/listings/${property.external_listing_id}`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'X-SparkApi-User-Agent': apiKey,
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal
                });

                clearTimeout(timer);
                checkedCount++;

                if (response.status === 404) {
                    await admin
                        .from('properties')
                        .update({ status: 'off_market' })
                        .eq('id', property.id);
                    markedInactive++;
                } else if (response.ok) {
                    const data = await response.json();
                    const mlsStatus = data.D?.Results?.[0]?.StandardFields?.MlsStatus;

                    if (mlsStatus && mlsStatus !== 'Active') {
                        const newStatus = mlsStatus === 'Pending' ? 'pending' :
                                         (mlsStatus === 'Sold' || mlsStatus === 'Closed') ? 'sold' :
                                         'off_market';
                        await admin
                            .from('properties')
                            .update({ status: newStatus })
                            .eq('id', property.id);
                        markedInactive++;
                    }
                }

                lastProcessedDate = property.updated_at || lastProcessedDate;
                await new Promise(r => setTimeout(r, 300));

            } catch (error) {
                console.error(`Error checking ${property.external_listing_id}:`, (error as Error).message);
            }
        }

        const cursorData = {
            sync_key: cursorKey,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            cached_data: { last_checked_date: lastProcessedDate, checked: checkedCount, marked: markedInactive }
        };

        if (cursorArr && cursorArr.length > 0) {
            await admin
                .from('sync_cache')
                .update(cursorData)
                .eq('id', cursorArr[0].id);
        } else {
            await admin.from('sync_cache').insert(cursorData);
        }

        return jsonResponse({
            success: true,
            duration_ms: Date.now() - startTime,
            checked: checkedCount,
            marked_inactive: markedInactive,
            batch_size: properties.length
        });

    } catch (error) {
        console.error('Check inactive listings error:', error);
        return jsonResponse({ error: (error as Error).message, duration_ms: Date.now() - startTime }, 500);
    }
});
