import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");
        const headers = { 'Authorization': `Bearer ${accessToken}`, 'X-SparkApi-User-Agent': apiKey };

        const body = await req.json().catch(() => ({}));
        const query = body.query || "ListOfficeName Eq 'Balboa Realty'";

        // Try the custom query
        const url1 = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent(`MlsStatus Eq 'Active' And ${query}`)}&_select=ListAgentMlsId,ListAgentFullName,ListAgentDirectPhone,ListOfficeName,ListOfficeMlsId,CoListAgentMlsId,CoListAgentFullName,ListingId,UnparsedAddress,ListPrice&_limit=50`;
        const res1 = await fetch(url1, { headers });
        const data1 = await res1.json();
        const listings = data1.D?.Results || [];

        const agents = {};
        const sampleListings = [];
        for (const l of listings) {
            const d = l.StandardFields || l;
            const name = d.ListAgentFullName || 'unknown';
            const mlsId = d.ListAgentMlsId || 'unknown';
            const key = `${mlsId}|${name}`;
            if (!agents[key]) {
                agents[key] = { mlsId, name, phone: d.ListAgentDirectPhone, office: d.ListOfficeName, officeMlsId: d.ListOfficeMlsId, count: 0 };
            }
            agents[key].count++;
            if (sampleListings.length < 5) {
                sampleListings.push({
                    listingId: d.ListingId,
                    address: d.UnparsedAddress,
                    price: d.ListPrice,
                    agent: name,
                    agentMlsId: mlsId,
                    coAgent: d.CoListAgentFullName,
                    coAgentMlsId: d.CoListAgentMlsId,
                    office: d.ListOfficeName,
                    officeMlsId: d.ListOfficeMlsId
                });
            }
        }

        // Also try searching the /v1/accounts endpoint for agent info
        let accountResults = null;
        try {
            const accUrl = `https://replication.sparkapi.com/v1/accounts?_filter=${encodeURIComponent("MemberMlsId Eq 'pc295'")}`;
            const accRes = await fetch(accUrl, { headers });
            if (accRes.ok) {
                const accData = await accRes.json();
                accountResults = accData.D?.Results || [];
            } else {
                accountResults = `Status ${accRes.status}`;
            }
        } catch (e) {
            accountResults = e.message;
        }

        return Response.json({
            query_used: query,
            total_results: listings.length,
            unique_agents: Object.values(agents),
            sample_listings: sampleListings,
            account_lookup_pc295: accountResults
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});