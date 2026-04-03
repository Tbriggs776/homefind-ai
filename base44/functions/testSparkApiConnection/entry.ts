import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user && user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");
        
        if (!apiKey || !accessToken) {
            return Response.json({ 
                error: 'Spark API credentials not configured',
                configured: false
            }, { status: 500 });
        }

        // Test connection with a simple listings query (using replication endpoint)
        const response = await fetch('https://replication.sparkapi.com/v1/listings?_limit=1', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'X-SparkApi-User-Agent': apiKey,
                'Content-Type': 'application/json'
            }
        });

        const responseText = await response.text();
        
        if (!response.ok) {
            return Response.json({
                configured: true,
                connection_successful: false,
                status: response.status,
                error: responseText
            });
        }

        const data = JSON.parse(responseText);
        const listings = data.D?.Results || [];

        return Response.json({
            configured: true,
            connection_successful: true,
            status: response.status,
            listings_available: listings.length,
            sample_listing: listings.length > 0 ? {
                id: listings[0].Id,
                address: listings[0].UnparsedAddress,
                city: listings[0].City,
                price: listings[0].ListPrice
            } : null
        });

    } catch (error) {
        return Response.json({ 
            configured: false,
            connection_successful: false,
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});