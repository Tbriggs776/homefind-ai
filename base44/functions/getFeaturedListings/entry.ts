import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

// Returns Paul Crandell's active listings from the local database.
// The Spark Replication API does NOT support filtering by agent, so we rely
// on the local DB which was populated correctly by the syncSparkApiListings job.

const AGENT_MLS_ID = 'pc295';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Query local database for this agent's active listings
        const listings = await base44.asServiceRole.entities.Property.filter(
            { list_agent_mls_id: AGENT_MLS_ID, status: 'active' },
            '-price',
            50
        );

        const properties = listings.map(p => ({
            id: p.id,
            address: p.address,
            city: p.city,
            state: p.state,
            zip_code: p.zip_code,
            latitude: p.latitude,
            longitude: p.longitude,
            price: p.price,
            original_list_price: p.original_list_price,
            bedrooms: p.bedrooms,
            bathrooms: p.bathrooms,
            square_feet: p.square_feet,
            lot_size: p.lot_size,
            year_built: p.year_built,
            description: p.description,
            images: p.images || [],
            virtual_tour_url: p.virtual_tour_url || '',
            status: p.status,
            mls_number: p.mls_number,
            days_on_market: p.days_on_market,
            features: p.features || [],
            listing_source: p.listing_source,
            list_office_name: p.list_office_name,
            is_featured: true
        }));

        return Response.json({
            properties,
            total_active_listings: '38,000+'
        });

    } catch (error) {
        console.error('getFeaturedListings error:', error);
        return Response.json({ error: error.message, properties: [] }, { status: 500 });
    }
});