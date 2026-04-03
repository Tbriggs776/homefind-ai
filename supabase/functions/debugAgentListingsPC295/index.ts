import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        try {
            if (user && user.role !== 'admin') {
                return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
            }
        } catch (_) {}

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        if (!accessToken) {
            return jsonResponse({ error: 'Spark OAuth access token not configured' }, 500);
        }

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        const testFilters = [
            { label: 'pc295 lowercase', filter: `MlsStatus Eq 'Active' And ListAgentMlsId Eq 'pc295'` },
            { label: 'PC295 uppercase', filter: `MlsStatus Eq 'Active' And ListAgentMlsId Eq 'PC295'` },
            { label: 'Pc295 mixed', filter: `MlsStatus Eq 'Active' And ListAgentMlsId Eq 'Pc295'` },
            { label: 'contains pc295', filter: `MlsStatus Eq 'Active' And ListAgentMlsId Eq '*pc295*'` },
        ];

        const testResults = [];
        for (const test of testFilters) {
            const url = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent(test.filter)}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName,StreetNumber,StreetName,City,ListPrice&_limit=5`;
            try {
                const res = await fetch(url, { headers });
                const data = await res.json();
                const results = data.D?.Results || [];
                testResults.push({
                    test: test.label,
                    count: results.length,
                    agents: results.map((l: any) => l.StandardFields?.ListAgentMlsId || l.ListAgentMlsId)
                });
            } catch (e) {
                testResults.push({ test: test.label, error: (e as Error).message });
            }
        }

        const sampleUrl = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName&_limit=20`;
        const sampleRes = await fetch(sampleUrl, { headers });
        const sampleData = await sampleRes.json();
        const sampleListings = sampleData.D?.Results || [];

        let { data: featuredInDB } = await admin
            .from('properties')
            .select('*')
            .eq('is_featured', true);
        if (!Array.isArray(featuredInDB)) featuredInDB = [];

        let { data: allProperties } = await admin
            .from('properties')
            .select('*');
        if (!Array.isArray(allProperties)) allProperties = [];

        return jsonResponse({
            spark_api_results: {
                filter_tests: testResults,
                sample_agent_ids: sampleListings.map((l: any) => l.StandardFields?.ListAgentMlsId || l.ListAgentMlsId),
                sample_offices: [...new Set(sampleListings.map((l: any) => l.StandardFields?.ListOfficeName || l.ListOfficeName))]
            },
            database_results: {
                total_properties: allProperties.length,
                featured_count: featuredInDB.length,
                featured_agents: [...new Set(featuredInDB.map((p: any) => p.list_agent_mls_id))],
                featured_sample: featuredInDB.slice(0, 5).map((p: any) => ({
                    id: p.id,
                    mls: p.mls_number,
                    agent: p.list_agent_mls_id,
                    address: p.address,
                    city: p.city,
                    is_featured: p.is_featured
                }))
            }
        });

    } catch (error) {
        console.error('Debug error:', error);
        return jsonResponse({ error: (error as Error).message, stack: (error as Error).stack }, 500);
    }
});
