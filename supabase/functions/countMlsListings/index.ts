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

        const filter = encodeURIComponent("MlsStatus Eq 'Active' And PropertyType Ne 'Residential Lease' And PropertyType Ne 'Rental'");
        const url = `https://replication.sparkapi.com/v1/listings?_filter=${filter}&_limit=1&_pagination=count`;

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'X-SparkApi-User-Agent': apiKey,
            }
        });

        const data = await res.json();
        const pagination = data.D?.Pagination || {};
        const totalCount = pagination.TotalRows || 'N/A';

        const sfFilter = encodeURIComponent("MlsStatus Eq 'Active' And PropertySubType Eq 'Single Family Residence'");
        const sfUrl = `https://replication.sparkapi.com/v1/listings?_filter=${sfFilter}&_limit=1&_pagination=count`;
        const sfRes = await fetch(sfUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'X-SparkApi-User-Agent': apiKey }
        });
        const sfData = await sfRes.json();
        const sfPagination = sfData.D?.Pagination || {};

        return jsonResponse({
            active_all_types: totalCount,
            active_single_family_residence: sfPagination.TotalRows ?? 'N/A',
            raw_pagination_sf: sfPagination,
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
