import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);
        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Admin only' }, 403);
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        const url = `https://replication.sparkapi.com/v1/listings` +
            `?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListPrice Ge 150000")}` +
            `&_select=Id,ListingId,MlsStatus,ListPrice,ListAgentMlsId,ListAgentKey,ListAgentStateLicense,ListAgentEmail,CoListAgentMlsId,CoListAgentKey` +
            `&_limit=5`;

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'X-SparkApi-User-Agent': apiKey,
            }
        });

        const raw = await res.text();
        return new Response(raw, { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
