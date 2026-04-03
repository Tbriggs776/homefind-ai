import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (!user || user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { address, city, state, zip_code } = await req.json();

        if (!address || !city || !state) {
            return jsonResponse({ error: 'Missing required fields: address, city, state' }, 400);
        }

        const fullAddress = `${address}, ${city}, ${state} ${zip_code || ''}`.trim();

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
            return jsonResponse({
                error: 'Geocoding service error',
                status: response.status
            }, 500);
        }

        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            return jsonResponse({
                error: 'Address not found',
                address: fullAddress
            }, 404);
        }

        const location = data[0];

        return jsonResponse({
            success: true,
            latitude: parseFloat(location.lat),
            longitude: parseFloat(location.lon),
            display_name: location.display_name
        });

    } catch (error) {
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
