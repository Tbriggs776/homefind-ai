import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { address, city, state, zip_code } = await req.json();

        if (!address || !city || !state) {
            return Response.json({ error: 'Missing required fields: address, city, state' }, { status: 400 });
        }

        // Build full address string
        const fullAddress = `${address}, ${city}, ${state} ${zip_code || ''}`.trim();

        // Use OpenStreetMap Nominatim for free geocoding
        const encodedAddress = encodeURIComponent(fullAddress);
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1`,
            {
                headers: {
                    'User-Agent': 'HomeFinder Property App'
                }
            }
        );

        if (!response.ok) {
            return Response.json({ 
                error: 'Geocoding service error',
                status: response.status 
            }, { status: 500 });
        }

        const data = await response.json();

        if (data.length === 0) {
            return Response.json({ 
                error: 'Address not found',
                address: fullAddress 
            }, { status: 404 });
        }

        const location = data[0];

        return Response.json({
            success: true,
            latitude: parseFloat(location.lat),
            longitude: parseFloat(location.lon),
            display_name: location.display_name
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});