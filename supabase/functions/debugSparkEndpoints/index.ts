import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        try {
            if (user && user.role !== 'admin') {
                return jsonResponse({ error: 'Forbidden' }, 403);
            }
        } catch (_) {}

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        const apiKey = Deno.env.get("SPARK_API_KEY");
        const sparkAccessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        const results: Record<string, any> = {};

        try {
            const url1 = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res1 = await fetch(url1, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } });
            const data1 = await res1.json();
            const listings1 = data1.D?.Results || [];
            results.replication_oauth = {
                status: res1.status,
                count: listings1.length,
                agents: listings1.map((l: any) => (l.StandardFields || l).ListAgentMlsId),
            };
        } catch (e) { results.replication_oauth = { error: (e as Error).message }; }

        try {
            const url2 = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res2 = await fetch(url2, { headers: { 'Authorization': `Bearer ${sparkAccessToken}`, 'X-SparkApi-User-Agent': apiKey, 'Accept': 'application/json' } });
            const data2 = await res2.json();
            const listings2 = data2.D?.Results || [];
            results.replication_apikey = {
                status: res2.status,
                count: listings2.length,
                agents: listings2.map((l: any) => (l.StandardFields || l).ListAgentMlsId),
            };
        } catch (e) { results.replication_apikey = { error: (e as Error).message }; }

        try {
            const url3 = `https://sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res3 = await fetch(url3, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } });
            const text3 = await res3.text();
            results.standard_oauth = {
                status: res3.status,
                body: text3.slice(0, 500),
            };
        } catch (e) { results.standard_oauth = { error: (e as Error).message }; }

        try {
            const url4 = `https://sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res4 = await fetch(url4, { headers: { 'Authorization': `Bearer ${sparkAccessToken}`, 'X-SparkApi-User-Agent': apiKey, 'Accept': 'application/json' } });
            const text4 = await res4.text();
            results.standard_apikey = {
                status: res4.status,
                body: text4.slice(0, 500),
            };
        } catch (e) { results.standard_apikey = { error: (e as Error).message }; }

        const { data: props } = await admin
            .from('properties')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);
        results.db_total_sample = Array.isArray(props) ? props.length : 'not_array';

        return jsonResponse(results);

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
