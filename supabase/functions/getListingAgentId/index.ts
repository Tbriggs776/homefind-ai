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

        const filter = `MlsStatus Eq 'Active' And ListingId Eq '6965362'`;
        const params = new URLSearchParams({
            _filter: filter,
            _limit: '1',
            _select: 'Id,ListingId,ListAgentStateLicense,ListAgentMlsId,ListAgentKey,ListAgentEmail,ListOfficeMlsId'
        });

        const response = await fetch(
            `https://replication.sparkapi.com/v1/listings?${params.toString()}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-SparkApi-User-Agent': apiKey
                }
            }
        );

        const data = await response.json();
        const result = data?.D?.Results?.[0];

        return jsonResponse({
            success: response.ok,
            status: response.status,
            listing: result,
            agent_fields: result ? {
                ListAgentStateLicense: result.StandardFields?.ListAgentStateLicense,
                ListAgentMlsId: result.StandardFields?.ListAgentMlsId,
                ListAgentKey: result.StandardFields?.ListAgentKey,
                ListAgentEmail: result.StandardFields?.ListAgentEmail,
                ListOfficeMlsId: result.StandardFields?.ListOfficeMlsId,
            } : null
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
