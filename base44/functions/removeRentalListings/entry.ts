import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        try {
            const user = await base44.auth.me();
            if (user?.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (e) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return Response.json({ error: 'Spark API credentials not configured' }, { status: 500 });
        }

        // Fetch all flexmls_idx properties from our DB in batches
        let allProperties = [];
        let offset = 0;
        const batchSize = 500;
        let hasMore = true;

        while (hasMore) {
            const batch = await base44.asServiceRole.entities.Property.filter(
                { listing_source: 'flexmls_idx' },
                '-created_date',
                batchSize
            );
            allProperties = allProperties.concat(batch);
            hasMore = batch.length === batchSize;
            offset += batchSize;
        }

        if (allProperties.length === 0) {
            return Response.json({ success: true, message: 'No properties to check', deleted: 0 });
        }

        // Query Spark API for all rental/lease listings to get their IDs
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
            results.forEach(listing => rentalExternalIds.add(String(listing.Id)));

            apiHasMore = results.length === 100;
            apiOffset += 100;

            if (apiHasMore) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Also filter locally by property type keywords as a safety net
        const rentalKeywords = ['lease', 'rental', 'rent'];
        
        // Find properties in our DB that are rentals
        const toDelete = allProperties.filter(p => {
            // Check if this external ID came back as a rental from Spark API
            if (rentalExternalIds.has(p.external_listing_id)) return true;
            // Also check description/type for rental keywords as fallback
            const desc = (p.description || '').toLowerCase();
            const type = (p.property_type || '').toLowerCase();
            return rentalKeywords.some(kw => type.includes(kw));
        });

        // Delete rental properties
        let deletedCount = 0;
        for (const property of toDelete) {
            await base44.asServiceRole.entities.Property.delete(property.id);
            deletedCount++;
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return Response.json({
            success: true,
            total_checked: allProperties.length,
            rental_ids_from_api: rentalExternalIds.size,
            deleted: deletedCount
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});