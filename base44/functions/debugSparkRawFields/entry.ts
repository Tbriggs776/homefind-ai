import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { mls_number } = await req.json();
        if (!mls_number) {
            return Response.json({ error: 'mls_number is required' }, { status: 400 });
        }

        const accessToken = Deno.env.get("SPARK_OAUTH_ACCESS_TOKEN");
        if (!accessToken) {
            return Response.json({ error: 'No access token' }, { status: 500 });
        }

        // Fetch with NO _select — get ALL fields
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
            return Response.json({ error: `Spark API ${response.status}`, details: text.slice(0, 500) }, { status: 500 });
        }

        const data = await response.json();
        const listing = data.D?.Results?.[0];
        if (!listing) {
            return Response.json({ error: 'Listing not found' }, { status: 404 });
        }

        const fields = listing.StandardFields || listing;
        
        // Get all field names and their values (excluding Photos array to keep response small)
        const fieldSummary = {};
        for (const [key, value] of Object.entries(fields)) {
            if (key === 'Photos') {
                fieldSummary[key] = `[${Array.isArray(value) ? value.length : 0} photos]`;
            } else if (key === 'VirtualTours') {
                fieldSummary[key] = value;
            } else if (key === 'OpenHouses') {
                fieldSummary[key] = value;
            } else {
                fieldSummary[key] = value;
            }
        }

        // Separate fields into categories for easier review
        const allFieldNames = Object.keys(fields).sort();
        
        // Identify fields we currently use in syncSparkApiListings
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

        // Only show unused fields that have meaningful values (not null/empty/false/0/masked)
        const meaningfulUnused = unusedFields
            .filter(f => {
                const v = fields[f];
                if (v == null || v === '' || v === false || v === 0) return false;
                if (typeof v === 'string' && v === '********') return false;
                return true;
            })
            .map(f => ({ field: f, value: fields[f], type: typeof fields[f] }));

        // Group into categories for easier review
        const categories = {
            property_details: meaningfulUnused.filter(f => /area|room|bed|bath|story|level|floor|living|garage|parking|pool|spa|fire|cool|heat|roof|found|construct|style|condition|feature|material|util/i.test(f.field)),
            location_geo: meaningfulUnused.filter(f => /lat|lng|long|geo|map|direct|region|area|zone|district|neighbor|commun|cross|road|highway/i.test(f.field)),
            financial: meaningfulUnused.filter(f => /price|tax|fee|assess|financ|loan|cost|value|escrow|mortgage/i.test(f.field)),
            listing_meta: meaningfulUnused.filter(f => /list|agent|office|broker|mls|status|date|time|stamp|day|market|pend|close|expir|cancel|withdraw/i.test(f.field)),
            association_hoa: meaningfulUnused.filter(f => /assoc|hoa|common|manage|restrict/i.test(f.field)),
            media: meaningfulUnused.filter(f => /photo|image|virtual|tour|video|media|url|link|supplement/i.test(f.field)),
        };

        return Response.json({
            mls_number,
            total_fields_available: allFieldNames.length,
            fields_we_use: usedFields.size,
            meaningful_unused_count: meaningfulUnused.length,
            fields_we_request_but_missing: missingFields,
            categorized_unused: categories,
            all_meaningful_unused: meaningfulUnused
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});