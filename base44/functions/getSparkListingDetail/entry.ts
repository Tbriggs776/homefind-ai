import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

// Fetches a single listing's full details from the Spark API by its Spark listing ID.
// Used when a property isn't in the local database (e.g. featured listings from home page).

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { listing_id } = await req.json();
        if (!listing_id) {
            return Response.json({ error: 'listing_id is required' }, { status: 400 });
        }

        const apiKey = Deno.env.get("SPARK_API_KEY");
        const accessToken = Deno.env.get("SPARK_ACCESS_TOKEN");

        if (!apiKey || !accessToken) {
            return Response.json({ error: 'Spark API credentials not configured' }, { status: 500 });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const url = `https://replication.sparkapi.com/v1/listings/${listing_id}?_expand=Photos`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'X-SparkApi-User-Agent': apiKey
            },
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return Response.json({ error: `Spark API returned ${response.status}` }, { status: response.status });
        }

        const data = await response.json();
        const listing = data.D?.Results?.[0];
        if (!listing) {
            return Response.json({ error: 'Listing not found' }, { status: 404 });
        }

        const sf = listing.StandardFields || {};

        const images = [];
        if (sf.Photos && Array.isArray(sf.Photos)) {
            for (let i = 0; i < Math.min(sf.Photos.length, 25); i++) {
                const p = sf.Photos[i];
                const url = p.Uri800 || p.Uri640 || p.UriLarge || p.Uri1024 || p.UriThumb;
                if (url) images.push(url);
            }
        }

        const address = [sf.StreetNumber, sf.StreetName, sf.StreetSuffix]
            .filter(Boolean).join(' ') || sf.UnparsedAddress || 'Address Not Available';

        const features = [];
        if (sf.PoolFeatures) features.push('Pool');
        if (sf.GarageSpaces > 0) features.push(`${sf.GarageSpaces}-Car Garage`);
        if (sf.WaterfrontYN) features.push('Waterfront');
        if (sf.FireplacesTotal > 0) features.push('Fireplace');
        if (sf.Cooling) features.push('Central Air');

        const property = {
            id: String(listing.Id),
            external_listing_id: String(listing.Id),
            address,
            city: sf.City || '',
            state: sf.StateOrProvince || '',
            zip_code: sf.PostalCode || '',
            county: sf.CountyOrParish || '',
            subdivision: sf.SubdivisionName || '',
            latitude: parseFloat(sf.Latitude) || null,
            longitude: parseFloat(sf.Longitude) || null,
            price: parseFloat(sf.ListPrice || 0),
            original_list_price: parseFloat(sf.OriginalListPrice || 0) || null,
            bedrooms: parseInt(sf.BedsTotal) || 0,
            bathrooms: parseFloat(sf.BathsTotal || 0),
            square_feet: parseInt(sf.BuildingAreaTotal || sf.LivingArea || 0),
            lot_size: parseFloat(sf.LotSizeArea || 0) || null,
            year_built: parseInt(sf.YearBuilt || 0),
            property_type: mapPropertyType(sf.PropertyType || sf.PropertySubType || ''),
            description: sf.PublicRemarks || '',
            images,
            virtual_tour_url: sf.VirtualTourURLUnbranded || '',
            status: (sf.MlsStatus || 'Active').toLowerCase() === 'active' ? 'active' : 'pending',
            mls_number: String(sf.ListingId || listing.Id || ''),
            days_on_market: parseInt(sf.DaysOnMarket || 0),
            features,
            listing_source: 'flexmls_idx',
            list_office_name: sf.ListOfficeName || '',
            list_agent_mls_id: sf.ListAgentMlsId || '',
            hoa_fee: parseFloat(sf.AssociationFee || 0) || null,
            hoa_fee_frequency: sf.AssociationFeeFrequency || '',
            hoa_required: !!sf.AssociationFee,
            tax_annual_amount: parseFloat(sf.TaxAnnualAmount || 0) || null,
            elementary_school: sf.ElementarySchool || '',
            middle_school: sf.MiddleOrJuniorSchool || '',
            high_school: sf.HighSchool || '',
            has_view: !!sf.View,
            view_description: sf.View || '',
            is_featured: true
        };

        return Response.json({ property });

    } catch (error) {
        console.error('getSparkListingDetail error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

function mapPropertyType(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('single') || t.includes('detached')) return 'single_family';
    if (t.includes('condo')) return 'condo';
    if (t.includes('town')) return 'townhouse';
    if (t.includes('multi')) return 'multi_family';
    if (t.includes('land') || t.includes('lot')) return 'land';
    return 'single_family';
}