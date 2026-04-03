import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const MAX_EXECUTION_MS = 25000;
const BATCH_SIZE = 20;
const FETCH_TIMEOUT_MS = 8000;

Deno.serve(async (req) => {
    const startTime = Date.now();
    try {
        const base44 = createClientFromRequest(req);

        try {
            const user = await base44.auth.me();
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (_) {
            // No user = scheduled automation
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return Response.json({ error: 'Spark API credentials not configured' }, { status: 500 });
        }

        // Load cursor to track where we left off
        const cursorKey = 'inactive_check_cursor';
        const cursorArr = await base44.asServiceRole.entities.SyncCache.filter({ sync_key: cursorKey });
        const lastCheckedDate = cursorArr[0]?.cached_data?.last_checked_date || '2000-01-01T00:00:00Z';

        // Fetch a batch of active properties older than our cursor
        const activeProperties = await base44.asServiceRole.entities.Property.filter({
            listing_source: 'flexmls_idx',
            status: 'active',
            updated_date: { $lte: lastCheckedDate }
        }, 'updated_date', BATCH_SIZE);

        // If nothing left below cursor, reset and grab oldest
        let properties = activeProperties;
        if (properties.length === 0) {
            properties = await base44.asServiceRole.entities.Property.filter({
                listing_source: 'flexmls_idx',
                status: 'active'
            }, 'updated_date', BATCH_SIZE);
        }

        if (properties.length === 0) {
            return Response.json({ success: true, message: 'No active properties to check', checked: 0, marked_inactive: 0 });
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
                    await base44.asServiceRole.entities.Property.update(property.id, { status: 'off_market' });
                    markedInactive++;
                } else if (response.ok) {
                    const data = await response.json();
                    const mlsStatus = data.D?.Results?.[0]?.StandardFields?.MlsStatus;

                    if (mlsStatus && mlsStatus !== 'Active') {
                        const newStatus = mlsStatus === 'Pending' ? 'pending' :
                                         (mlsStatus === 'Sold' || mlsStatus === 'Closed') ? 'sold' :
                                         'off_market';
                        await base44.asServiceRole.entities.Property.update(property.id, { status: newStatus });
                        markedInactive++;
                    }
                }

                lastProcessedDate = property.updated_date || lastProcessedDate;
                await new Promise(r => setTimeout(r, 300));

            } catch (error) {
                console.error(`Error checking ${property.external_listing_id}:`, error.message);
            }
        }

        // Save cursor
        const cursorData = {
            sync_key: cursorKey,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            cached_data: { last_checked_date: lastProcessedDate, checked: checkedCount, marked: markedInactive }
        };
        if (cursorArr.length > 0) {
            await base44.asServiceRole.entities.SyncCache.update(cursorArr[0].id, cursorData);
        } else {
            await base44.asServiceRole.entities.SyncCache.create(cursorData);
        }

        return Response.json({
            success: true,
            duration_ms: Date.now() - startTime,
            checked: checkedCount,
            marked_inactive: markedInactive,
            batch_size: properties.length
        });

    } catch (error) {
        console.error('Check inactive listings error:', error);
        return Response.json({ error: error.message, duration_ms: Date.now() - startTime }, { status: 500 });
    }
});