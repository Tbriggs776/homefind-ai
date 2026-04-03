import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();

        const { searchParams } = new URL(req.url);
        const city = searchParams.get('city');
        const minPrice = searchParams.get('minPrice');
        const maxPrice = searchParams.get('maxPrice');
        const limit = searchParams.get('limit') || '50';

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return jsonResponse({ error: 'Spark API credentials not configured' }, 500);
        }

        let filters = ["MlsStatus Eq 'Active'"];

        if (city) {
            filters.push(`City Eq '${city}'`);
        }
        if (minPrice) {
            filters.push(`ListPrice Ge ${minPrice}`);
        }
        if (maxPrice) {
            filters.push(`ListPrice Le ${maxPrice}`);
        }

        const filterString = filters.join(' And ');
        const apiUrl = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent(filterString)}&_limit=${limit}`;

        const response = await fetch(apiUrl, {
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

        const data = await response.json();
        const listings = data.D?.Results || [];

        return jsonResponse({
            success: true,
            count: listings.length,
            listings: listings
        });

    } catch (error) {
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
