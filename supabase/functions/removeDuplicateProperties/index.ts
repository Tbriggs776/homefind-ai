import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { data: allProperties } = await admin
            .from('properties')
            .select('*')
            .eq('listing_source', 'flexmls_idx');

        if (!allProperties || allProperties.length === 0) {
            return jsonResponse({ success: true, duplicates_removed: 0, no_images_removed: 0, total_removed: 0 });
        }

        const grouped = new Map();
        for (const prop of allProperties) {
            if (!prop.external_listing_id) continue;

            if (!grouped.has(prop.external_listing_id)) {
                grouped.set(prop.external_listing_id, []);
            }
            grouped.get(prop.external_listing_id).push(prop);
        }

        let duplicatesRemoved = 0;
        const toDelete = [];

        for (const [externalId, properties] of grouped) {
            if (properties.length > 1) {
                properties.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                for (let i = 1; i < properties.length; i++) {
                    toDelete.push(properties[i].id);
                }
                duplicatesRemoved += properties.length - 1;
            }
        }

        if (toDelete.length > 0) {
            const batchSize = 10;
            for (let i = 0; i < toDelete.length; i += batchSize) {
                const batch = toDelete.slice(i, i + batchSize);
                for (const id of batch) {
                    await admin.from('properties').delete().eq('id', id);
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        let noImagesRemoved = 0;
        const { data: propertiesWithoutImages } = await admin
            .from('properties')
            .select('*')
            .eq('listing_source', 'flexmls_idx')
            .is('images', null);

        if (propertiesWithoutImages && propertiesWithoutImages.length > 0) {
            for (const prop of propertiesWithoutImages) {
                await admin.from('properties').delete().eq('id', prop.id);
                noImagesRemoved++;
            }
        }

        return jsonResponse({
            success: true,
            duplicates_removed: duplicatesRemoved,
            no_images_removed: noImagesRemoved,
            total_removed: duplicatesRemoved + noImagesRemoved
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
