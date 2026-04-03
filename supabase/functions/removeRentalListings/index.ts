import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return jsonResponse({ error: 'Spark API credentials not configured' }, 500);
        }

        let allProperties = [];
        let offset = 0;
        const batchSize = 500;
        let hasMore = true;

        while (hasMore) {
            const { data: batch } = await admin
                .from('properties')
                .select('*')
                .eq('listing_source', 'flexmls_idx')
                .order('created_at', { ascending: false })
                .range(offset, offset + batchSize - 1);

            if (batch) {
                allProperties = allProperties.concat(batch);
                hasMore = batch.length === batchSize;
            } else {
                hasMore = false;
            }
            offset += batchSize;
        }

        if (allProperties.length === 0) {
            return jsonResponse({ success: true, message: 'No properties to check', deleted: 0 });
        }

        const rentalFilter = "PropertyType Eq 'Residential Lease' Or PropertyType Eq 'Rental'";
        let rentalExternalIds = new Set();
        let apiOffset = 0;
        let apiHasMore = true;

        while (apiHasMore) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);

            const response = await fetch(
                `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent(rentalFilter)}&_select=Id&_limit=100&_offset=${apiOffset}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'X-SparkApi-User-Agent': apiKey,
                    },
                    signal: controller.signal
                }
            );
            clearTimeout(timeout);

            if (!response.ok) break;

            const data = await response.json();
            const results = data.D?.Results || [];
            results.forEach((listing: any) => rentalExternalIds.add(String(listing.Id)));

            apiHasMore = results.length === 100;
            apiOffset += 100;

            if (apiHasMore) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const rentalKeywords = ['lease', 'rental', 'rent'];

        const toDelete = allProperties.filter(p => {
            if (rentalExternalIds.has(p.external_listing_id)) return true;
            const desc = (p.description || '').toLowerCase();
            const type = (p.property_type || '').toLowerCase();
            return rentalKeywords.some(kw => type.includes(kw));
        });

        let deletedCount = 0;
        for (const property of toDelete) {
            await admin.from('properties').delete().eq('id', property.id);
            deletedCount++;
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return jsonResponse({
            success: true,
            total_checked: allProperties.length,
            rental_ids_from_api: rentalExternalIds.size,
            deleted: deletedCount
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
