import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Admin only' }, { status: 403 });
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
        return Response.json({ error: error.message }, { status: 500 });
    }
});