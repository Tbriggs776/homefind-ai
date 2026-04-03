import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Fetch all properties with external_listing_id
        const allProperties = await base44.asServiceRole.entities.Property.filter({
            listing_source: 'flexmls_idx'
        });

        // Group by external_listing_id
        const grouped = new Map();
        for (const prop of allProperties) {
            if (!prop.external_listing_id) continue;
            
            if (!grouped.has(prop.external_listing_id)) {
                grouped.set(prop.external_listing_id, []);
            }
            grouped.get(prop.external_listing_id).push(prop);
        }

        // Find duplicates and keep only the newest one (by created_date)
        let duplicatesRemoved = 0;
        const toDelete = [];

        for (const [externalId, properties] of grouped) {
            if (properties.length > 1) {
                // Sort by created_date, keep the newest
                properties.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
                
                // Mark all except the first (newest) for deletion
                for (let i = 1; i < properties.length; i++) {
                    toDelete.push(properties[i].id);
                }
                duplicatesRemoved += properties.length - 1;
            }
        }

        // Delete duplicates in batches
        if (toDelete.length > 0) {
            const batchSize = 10;
            for (let i = 0; i < toDelete.length; i += batchSize) {
                const batch = toDelete.slice(i, i + batchSize);
                for (const id of batch) {
                    await base44.asServiceRole.entities.Property.delete(id);
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Also delete properties without images
        const propertiesWithoutImages = await base44.asServiceRole.entities.Property.filter({
            listing_source: 'flexmls_idx',
            images: []
        });

        let noImagesRemoved = 0;
        if (propertiesWithoutImages.length > 0) {
            for (const prop of propertiesWithoutImages) {
                await base44.asServiceRole.entities.Property.delete(prop.id);
                noImagesRemoved++;
            }
        }

        return Response.json({
            success: true,
            duplicates_removed: duplicatesRemoved,
            no_images_removed: noImagesRemoved,
            total_removed: duplicatesRemoved + noImagesRemoved
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});