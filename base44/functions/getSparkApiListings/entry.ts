import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Get request parameters
        const { searchParams } = new URL(req.url);
        const city = searchParams.get('city');
        const minPrice = searchParams.get('minPrice');
        const maxPrice = searchParams.get('maxPrice');
        const limit = searchParams.get('limit') || '50';

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");
        
        if (!apiKey || !accessToken) {
            return Response.json({ error: 'Spark API credentials not configured' }, { status: 500 });
        }

        // Build Spark API filter
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

        // Fetch from Spark API
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
            return Response.json({ 
                error: 'Failed to fetch from Spark API', 
                details: errorText,
                status: response.status 
            }, { status: 500 });
        }

        const data = await response.json();
        const listings = data.D?.Results || [];
        
        return Response.json({
            success: true,
            count: listings.length,
            listings: listings
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});