import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");
        
        if (!apiKey || !accessToken) {
            return Response.json({ error: 'Spark API credentials not configured' }, { status: 500 });
        }

        // Get rate limit data
        const rateLimitKey = 'spark_api_rate_limit';
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        
        const rateLimitCache = await base44.asServiceRole.entities.SyncCache.filter({ 
            sync_key: rateLimitKey 
        });
        
        let recentCalls = [];
        if (rateLimitCache.length > 0) {
            const data = rateLimitCache[0].cached_data || {};
            recentCalls = (data.calls || []).filter(timestamp => now - timestamp < fiveMinutes);
        }

        // Test simple API call
        const testStart = Date.now();
        const testResponse = await fetch(
            `https://replication.sparkapi.com/v1/listings?_limit=1`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-SparkApi-User-Agent': apiKey
                }
            }
        );
        const testDuration = Date.now() - testStart;

        const testData = testResponse.ok ? await testResponse.json() : null;

        // Get sync history
        const syncCache = await base44.asServiceRole.entities.SyncCache.filter({ 
            sync_key: 'spark_api_listings' 
        });

        return Response.json({
            rate_limit: {
                max_per_5_min: 1500,
                current_calls: recentCalls.length,
                remaining: 1500 - recentCalls.length,
                percentage_used: ((recentCalls.length / 1500) * 100).toFixed(1) + '%'
            },
            test_call: {
                success: testResponse.ok,
                status: testResponse.status,
                duration_ms: testDuration,
                results_count: testData?.D?.Results?.length || 0
            },
            last_sync: syncCache.length > 0 ? {
                date: syncCache[0].last_sync_date,
                status: syncCache[0].sync_status,
                total_fetched: syncCache[0].total_fetched,
                error: syncCache[0].error_message
            } : null,
            credentials_present: {
                api_key: !!apiKey,
                access_token: !!accessToken
            }
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});