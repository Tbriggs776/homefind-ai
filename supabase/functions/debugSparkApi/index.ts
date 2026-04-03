import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (!user || user.role !== 'admin') {
            return jsonResponse({ error: 'Admin access required' }, 403);
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return jsonResponse({ error: 'Spark API credentials not configured' }, 500);
        }

        const rateLimitKey = 'spark_api_rate_limit';
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        const { data: rateLimitCache } = await admin
            .from('sync_cache')
            .select('*')
            .eq('sync_key', rateLimitKey);

        let recentCalls = [];
        if (rateLimitCache && rateLimitCache.length > 0) {
            const data = rateLimitCache[0].cached_data || {};
            recentCalls = ((data.calls || []) as number[]).filter(timestamp => now - timestamp < fiveMinutes);
        }

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

        const { data: syncCache } = await admin
            .from('sync_cache')
            .select('*')
            .eq('sync_key', 'spark_api_listings');

        return jsonResponse({
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
            last_sync: syncCache && syncCache.length > 0 ? {
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
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
