import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);
        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");
        const oauthToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");

        const results: Record<string, any> = {};

        const filter1 = `MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'`;
        const params1 = new URLSearchParams({
            _filter: filter1,
            _limit: '5',
            _select: 'ListAgentMlsId,ListAgentName,ListOfficeName,ListPrice,City,StreetName,ListingId'
        });

        const resp1 = await fetch(
            `https://replication.sparkapi.com/v1/listings?${params1.toString()}`,
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'X-SparkApi-User-Agent': apiKey } }
        );
        const data1 = await resp1.json();
        results.replication_api = {
            status: resp1.status,
            total: data1.D?.Pagination?.TotalRows,
            first_agent: data1.D?.Results?.[0]?.StandardFields?.ListAgentMlsId,
            first_agent_name: data1.D?.Results?.[0]?.StandardFields?.ListAgentName,
            count: data1.D?.Results?.length
        };

        const filter2 = `MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'`;
        const params2 = new URLSearchParams({
            _filter: filter2,
            _limit: '5',
            _select: 'ListAgentMlsId,ListAgentName,ListOfficeName,ListPrice,City,StreetName,ListingId'
        });

        const resp2 = await fetch(
            `https://sparkapi.com/v1/listings?${params2.toString()}`,
            { headers: { 'Authorization': `Bearer ${oauthToken}` } }
        );
        const data2text = await resp2.text();
        let data2: any;
        try { data2 = JSON.parse(data2text); } catch { data2 = data2text.slice(0, 500); }

        results.standard_api = {
            status: resp2.status,
            total: data2?.D?.Pagination?.TotalRows,
            first_agent: data2?.D?.Results?.[0]?.StandardFields?.ListAgentMlsId,
            first_agent_name: data2?.D?.Results?.[0]?.StandardFields?.ListAgentName,
            count: data2?.D?.Results?.length,
            raw_preview: typeof data2 === 'string' ? data2 : undefined
        };

        const filter3 = `MlsStatus Eq 'Active' And ListAgentId Eq 'pc295'`;
        const params3 = new URLSearchParams({
            _filter: filter3,
            _limit: '5',
            _select: 'ListAgentMlsId,ListAgentId,ListAgentName,ListOfficeName,ListPrice,City,ListingId'
        });

        const resp3 = await fetch(
            `https://replication.sparkapi.com/v1/listings?${params3.toString()}`,
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'X-SparkApi-User-Agent': apiKey } }
        );
        const data3 = await resp3.json();
        results.replication_with_ListAgentId = {
            status: resp3.status,
            total: data3.D?.Pagination?.TotalRows,
            first_agent: data3.D?.Results?.[0]?.StandardFields?.ListAgentMlsId,
            first_agent_id: data3.D?.Results?.[0]?.StandardFields?.ListAgentId,
            first_agent_name: data3.D?.Results?.[0]?.StandardFields?.ListAgentName,
            count: data3.D?.Results?.length
        };

        const filter4 = `MlsStatus Eq 'Active' And ListAgentName Eq 'Paul Crandell'`;
        const params4 = new URLSearchParams({
            _filter: filter4,
            _limit: '5',
            _select: 'ListAgentMlsId,ListAgentId,ListAgentName,ListOfficeName,ListPrice,City,ListingId'
        });

        const resp4 = await fetch(
            `https://replication.sparkapi.com/v1/listings?${params4.toString()}`,
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'X-SparkApi-User-Agent': apiKey } }
        );
        const data4 = await resp4.json();
        results.by_agent_name = {
            status: resp4.status,
            total: data4.D?.Pagination?.TotalRows,
            listings: (data4.D?.Results || []).map((l: any) => ({
                id: l.StandardFields?.ListingId,
                agent_id: l.StandardFields?.ListAgentMlsId,
                agent_name: l.StandardFields?.ListAgentName,
                price: l.StandardFields?.ListPrice,
                city: l.StandardFields?.City
            }))
        };

        return jsonResponse(results);
    } catch (error) {
        return jsonResponse({ error: (error as Error).message, stack: (error as Error).stack?.slice(0, 500) }, 500);
    }
});
