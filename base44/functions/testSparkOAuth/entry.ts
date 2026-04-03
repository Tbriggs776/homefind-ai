import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        const BASE = "https://replication.sparkapi.com/v1";

        // TEST 1: Count active IDX listings
        let idxActive = null;
        try {
            const r1 = await fetch(`${BASE}/listings?_filter=StandardStatus eq 'Active'&_pagination=count&_limit=2`, { headers });
            const d1 = await r1.json();
            const sample = (d1.D?.Results || []).map(l => {
                const s = l.StandardFields || l;
                return {
                    id: s.ListingId, address: s.UnparsedFirstLineAddress || s.UnparsedAddress,
                    price: s.ListPrice, mlsStatus: s.MlsStatus, city: s.City,
                    beds: s.BedroomsTotal, baths: s.BathroomsTotal, sqft: s.BuildingAreaTotal,
                    propertyType: s.PropertyType, lat: s.Latitude, lng: s.Longitude,
                    office: s.ListOfficeName, agent: s.ListAgentFullName,
                    photos: s.Photos?.length || 0
                };
            });
            idxActive = { total: d1.D?.Pagination?.TotalRows, sample };
        } catch (e) { idxActive = { error: e.message }; }

        // TEST 2: Coming Soon
        let idxComingSoon = null;
        try {
            const r2 = await fetch(`${BASE}/listings?_filter=MlsStatus eq 'Coming Soon'&_pagination=count&_limit=2`, { headers });
            const d2 = await r2.json();
            const sample = (d2.D?.Results || []).map(l => {
                const s = l.StandardFields || l;
                return { id: s.ListingId, address: s.UnparsedFirstLineAddress || s.UnparsedAddress, price: s.ListPrice, status: s.MlsStatus, city: s.City };
            });
            idxComingSoon = { total: d2.D?.Pagination?.TotalRows, sample };
        } catch (e) { idxComingSoon = { error: e.message }; }

        // TEST 3: Pending
        let idxPending = null;
        try {
            const r3 = await fetch(`${BASE}/listings?_filter=StandardStatus eq 'Pending'&_pagination=count&_limit=1`, { headers });
            const d3 = await r3.json();
            idxPending = { total: d3.D?.Pagination?.TotalRows };
        } catch (e) { idxPending = { error: e.message }; }

        // TEST 4: MlsStatus values
        let mlsStatuses = null;
        try {
            const r4 = await fetch(`${BASE}/standardfields/MlsStatus`, { headers });
            const d4 = await r4.json();
            const fields = d4.D?.Results?.[0]?.MlsStatus?.FieldList || [];
            mlsStatuses = fields.map(f => ({ value: f.Value, longValue: f.LongValue }));
        } catch (e) { mlsStatuses = { error: e.message }; }

        // TEST 5: PropertyType values
        let propertyTypes = null;
        try {
            const r5 = await fetch(`${BASE}/standardfields/PropertyType`, { headers });
            const d5 = await r5.json();
            const ptFields = d5.D?.Results?.[0]?.PropertyType?.FieldList || [];
            propertyTypes = ptFields.map(f => ({ value: f.Value, longValue: f.LongValue }));
        } catch (e) { propertyTypes = { error: e.message }; }

        // TEST 6: Sample residential listing with full fields to see what's available
        let sampleFull = null;
        try {
            const r6 = await fetch(`${BASE}/listings?_filter=StandardStatus eq 'Active' And PropertyType eq 'A'&_limit=1&_expand=Photos`, { headers });
            const d6 = await r6.json();
            const l = d6.D?.Results?.[0];
            if (l) {
                const s = l.StandardFields || l;
                sampleFull = {
                    all_field_names: Object.keys(s).sort(),
                    photos_count: s.Photos?.length || 0,
                    first_photo: s.Photos?.[0]?.Uri300 || s.Photos?.[0]?.UriLarge || null
                };
            }
        } catch (e) { sampleFull = { error: e.message }; }

        return Response.json({
            idx_active: idxActive,
            idx_coming_soon: idxComingSoon,
            idx_pending: idxPending,
            mls_statuses: mlsStatuses,
            property_types: propertyTypes,
            sample_full_listing: sampleFull
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});