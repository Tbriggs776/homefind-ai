import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { searchParams } = new URL(req.url);
        const address = searchParams.get('address') || '22839 NIGHTINGALE';

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return jsonResponse({ error: 'Spark API credentials not configured' }, 500);
        }

        const filters = `UnparsedAddress Like '${address}%'`;

        const response = await fetch(`https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent(filters)}&_expand=Photos&_limit=5`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'X-SparkApi-User-Agent': apiKey,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return jsonResponse({
                error: 'Failed to fetch from Spark API',
                details: errorText,
                status: response.status
            }, 500);
        }

        const responseData = await response.json();
        const listings = responseData.D?.Results || [];

        if (listings.length === 0) {
            return jsonResponse({
                error: 'No listings found',
                searched_address: address
            });
        }

        const listing = listings[0];
        const data = listing.StandardFields || {};

        return jsonResponse({
            listing_id: listing.Id,
            address: data.UnparsedAddress,
            has_photos_field: !!data.Photos,
            photos_array_length: data.Photos ? data.Photos.length : 0,
            photos_structure: data.Photos ? data.Photos.slice(0, 3).map((p: any) => ({
                available_fields: Object.keys(p),
                Uri300: p.Uri300,
                Uri640: p.Uri640,
                Uri800: p.Uri800,
                Uri1024: p.Uri1024,
                UriLarge: p.UriLarge,
                UriThumb: p.UriThumb
            })) : null,
            raw_first_photo: data.Photos && data.Photos[0] ? data.Photos[0] : null,
            all_available_fields: Object.keys(data),
            media_field: data.Media || null
        });

    } catch (error) {
        console.error('Debug error:', error);
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
