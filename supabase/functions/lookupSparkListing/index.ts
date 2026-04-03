import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);
        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { mls_number } = await req.json();
        if (!mls_number) {
            return jsonResponse({ error: 'mls_number is required' }, 400);
        }

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        const sparkFilter = `ListingId Eq '${mls_number}'`;
        const selectFields = 'ListingId,ListAgentMlsId,ListAgentName,ListAgentFirstName,ListAgentLastName,CoListAgentMlsId,CoListAgentName,ListOfficeName,ListOfficePhone,MlsStatus,ListPrice,StreetNumber,StreetName,City';

        const url = `https://replication.sparkapi.com/v1/listings?_filter=${encodeURIComponent(sparkFilter)}&_select=${selectFields}`;

        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errorText = await response.text();
            return jsonResponse({ error: `Spark API error: ${response.status}`, details: errorText.slice(0, 500) }, 500);
        }

        const data = await response.json();
        const listings = data.D?.Results || [];

        if (listings.length === 0) {
            return jsonResponse({ error: 'Listing not found in Spark API' }, 404);
        }

        const listing = listings[0];
        const fields = listing.StandardFields || listing;

        return jsonResponse({
            mls_number: fields.ListingId,
            list_agent_mls_id: fields.ListAgentMlsId || null,
            list_agent_name: fields.ListAgentName || `${fields.ListAgentFirstName || ''} ${fields.ListAgentLastName || ''}`.trim() || null,
            co_list_agent_mls_id: fields.CoListAgentMlsId || null,
            co_list_agent_name: fields.CoListAgentName || null,
            list_office_name: fields.ListOfficeName || null,
            list_office_phone: fields.ListOfficePhone || null,
            mls_status: fields.MlsStatus,
            list_price: fields.ListPrice,
            address: `${fields.StreetNumber || ''} ${fields.StreetName || ''}`.trim(),
            city: fields.City
        });
    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
