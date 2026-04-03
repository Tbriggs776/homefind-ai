import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        // Fetch just 1 listing but get the total count from pagination info
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

        // Single Family (PropertyType A = Residential, SubType = Single Family Residence)
        const sfFilter = encodeURIComponent("MlsStatus Eq 'Active' And PropertySubType Eq 'Single Family Residence'");
        const sfUrl = `https://replication.sparkapi.com/v1/listings?_filter=${sfFilter}&_limit=1&_pagination=count`;
        const sfRes = await fetch(sfUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'X-SparkApi-User-Agent': apiKey }
        });
        const sfData = await sfRes.json();
        const sfPagination = sfData.D?.Pagination || {};

        return Response.json({
            active_all_types: totalCount,
            active_single_family_residence: sfPagination.TotalRows ?? 'N/A',
            raw_pagination_sf: sfPagination,
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});