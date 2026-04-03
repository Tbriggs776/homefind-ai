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
        if (!accessToken) {
            return jsonResponse({ error: 'No access token' }, 500);
        }

        const url = `https://replication.sparkapi.com/v1/listings` +
            `?_filter=ListingId Eq '${mls_number}'` +
            `&_expand=Photos,VirtualTours,OpenHouses`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            return jsonResponse({ error: `Spark API ${response.status}`, details: text.slice(0, 500) }, 500);
        }

        const data = await response.json();
        const listing = data.D?.Results?.[0];
        if (!listing) {
            return jsonResponse({ error: 'Listing not found' }, 404);
        }

        const fields = listing.StandardFields || listing;

        const fieldSummary: Record<string, any> = {};
        for (const [key, value] of Object.entries(fields)) {
            if (key === 'Photos') {
                fieldSummary[key] = `[${Array.isArray(value) ? value.length : 0} photos]`;
            } else if (key === 'VirtualTours' || key === 'OpenHouses') {
                fieldSummary[key] = value;
            } else {
                fieldSummary[key] = value;
            }
        }

        const allFieldNames = Object.keys(fields).sort();

        const usedFields = new Set([
            'Id','ListingId','MlsStatus','PropertyType','PropertySubType',
            'StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','StreetDirSuffix','UnparsedAddress',
            'City','StateOrProvince','PostalCode','CountyOrParish','SubdivisionName',
            'Latitude','Longitude','ListPrice','OriginalListPrice',
            'BedsTotal','BathsFull','BathsHalf',
            'BuildingAreaTotal','LivingArea','SquareFeet',
            'LotSizeAcres','YearBuilt','PublicRemarks','DaysOnMarket',
            'ModificationTimestamp','ListingContractDate','OnMarketDate',
            'PoolFeatures','PoolPrivateYN','GarageSpaces','WaterfrontYN','FireplacesTotal',
            'Basement','PatioAndPorchFeatures','Cooling','Flooring',
            'ParkingFeatures','GarageType',
            'Stories','Levels','AssociationYN','AssociationFee','AssociationFeeFrequency',
            'CommunityFeatures','SeniorCommunityYN',
            'GreenEnergyEfficient','GreenEnergyGeneration','PowerProductionType',
            'OtherStructures','ArchitecturalStyle','InteriorFeatures',
            'PropertyCondition','Roof','ExteriorFeatures',
            'SpaFeatures','SpaYN','View','ViewYN',
            'TaxAnnualAmount',
            'ElementarySchool','MiddleOrJuniorSchool','HighSchool',
            'VirtualTourURLUnbranded',
            'ListAgentMlsId','CoListAgentMlsId','ListOfficeName',
            'Photos','VirtualTours','OpenHouses'
        ]);

        const unusedFields = allFieldNames.filter(f => !usedFields.has(f));
        const missingFields = [...usedFields].filter(f => !allFieldNames.includes(f));

        const meaningfulUnused = unusedFields
            .filter(f => {
                const v = (fields as any)[f];
                if (v == null || v === '' || v === false || v === 0) return false;
                if (typeof v === 'string' && v === '********') return false;
                return true;
            })
            .map(f => ({ field: f, value: (fields as any)[f], type: typeof (fields as any)[f] }));

        return jsonResponse({
            mls_number,
            total_fields_available: allFieldNames.length,
            fields_we_use: usedFields.size,
            meaningful_unused_count: meaningfulUnused.length,
            fields_we_request_but_missing: missingFields,
            all_meaningful_unused: meaningfulUnused
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
