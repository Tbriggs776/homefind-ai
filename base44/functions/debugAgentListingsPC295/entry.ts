import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Debug function to check what listings exist for agent pc295

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Check admin access
        try {
            const user = await base44.auth.me();
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (_) {}

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        if (!accessToken) {
            return Response.json({ error: 'Spark OAuth access token not configured' }, { status: 500 });
        }

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        // Test 1: Try multiple variations of the agent ID
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
                    agents: results.map(l => l.StandardFields?.ListAgentMlsId || l.ListAgentMlsId)
                });
            } catch (e) {
                testResults.push({ test: test.label, error: e.message });
            }
        }

        // Test 2: Get a sample of active listings to see agent ID format
        const sampleUrl = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active'")}&_select=Id,ListingId,ListAgentMlsId,ListOfficeName&_limit=20`;
        const sampleRes = await fetch(sampleUrl, { headers });
        const sampleData = await sampleRes.json();
        const sampleListings = sampleData.D?.Results || [];
        
        const activeListings = [];
        const pendingListings = [];

        // Test 3: Check what's in our DB marked as featured
        let featuredInDB = await base44.asServiceRole.entities.Property.filter({ is_featured: true });
        if (!Array.isArray(featuredInDB)) featuredInDB = [];
        
        // Test 4: Count total properties in DB
        let allProperties = await base44.asServiceRole.entities.Property.filter({});
        if (!Array.isArray(allProperties)) allProperties = [];

        return Response.json({
            spark_api_results: {
                filter_tests: testResults,
                sample_agent_ids: sampleListings.map(l => l.StandardFields?.ListAgentMlsId || l.ListAgentMlsId),
                sample_offices: [...new Set(sampleListings.map(l => l.StandardFields?.ListOfficeName || l.ListOfficeName))]
            },
            database_results: {
                total_properties: allProperties.length,
                featured_count: featuredInDB.length,
                featured_agents: [...new Set(featuredInDB.map(p => p.list_agent_mls_id))],
                featured_sample: featuredInDB.slice(0, 5).map(p => ({
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
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});