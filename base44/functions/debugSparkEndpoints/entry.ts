import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Test different Spark API endpoints for agent filtering

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        try {
            const user = await base44.auth.me();
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden' }, { status: 403 });
            }
        } catch (_) {}

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        const apiKey = Deno.env.get("SPARK_API_KEY");
        const sparkAccessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        const results = {};

        // Test 1: Replication API with agent filter (known broken)
        try {
            const url1 = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res1 = await fetch(url1, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } });
            const data1 = await res1.json();
            const listings1 = data1.D?.Results || [];
            results.replication_oauth = {
                status: res1.status,
                count: listings1.length,
                agents: listings1.map(l => (l.StandardFields || l).ListAgentMlsId),
            };
        } catch (e) { results.replication_oauth = { error: e.message }; }

        // Test 2: Replication API with the other credentials
        try {
            const url2 = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res2 = await fetch(url2, { headers: { 'Authorization': `Bearer ${sparkAccessToken}`, 'X-SparkApi-User-Agent': apiKey, 'Accept': 'application/json' } });
            const data2 = await res2.json();
            const listings2 = data2.D?.Results || [];
            results.replication_apikey = {
                status: res2.status,
                count: listings2.length,
                agents: listings2.map(l => (l.StandardFields || l).ListAgentMlsId),
            };
        } catch (e) { results.replication_apikey = { error: e.message }; }

        // Test 3: Standard Spark API (sparkapi.com, not replication)
        try {
            const url3 = `https://sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res3 = await fetch(url3, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } });
            const text3 = await res3.text();
            results.standard_oauth = {
                status: res3.status,
                body: text3.slice(0, 500),
            };
        } catch (e) { results.standard_oauth = { error: e.message }; }

        // Test 4: Standard API with API key creds
        try {
            const url4 = `https://sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,City,ListPrice&_limit=3`;
            const res4 = await fetch(url4, { headers: { 'Authorization': `Bearer ${sparkAccessToken}`, 'X-SparkApi-User-Agent': apiKey, 'Accept': 'application/json' } });
            const text4 = await res4.text();
            results.standard_apikey = {
                status: res4.status,
                body: text4.slice(0, 500),
            };
        } catch (e) { results.standard_apikey = { error: e.message }; }

        // Test 5: Count total properties in our DB
        const props = await base44.asServiceRole.entities.Property.list('-created_date', 1);
        results.db_total_sample = Array.isArray(props) ? props.length : 'not_array';

        return Response.json(results);

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});