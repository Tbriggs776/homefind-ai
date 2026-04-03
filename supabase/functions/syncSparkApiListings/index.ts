import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface SparkListing {
  [key: string]: any;
}

interface PropertyData {
  [key: string]: any;
}

// Helper function to map property type
function mapPropertyType(sparkType: string): string {
  const typeMap: Record<string, string> = {
    'Residential': 'single_family',
    'Residential Income': 'multi_family',
    'Condo/Townhouse/Row House/Coach House': 'condo',
    'Land': 'land',
    'Commercial': 'commercial',
    'Vacant Land': 'land',
  };
  return typeMap[sparkType] || sparkType || 'unknown';
}

// Helper function to map status
function mapStatus(sparkStatus: string): string {
  const statusMap: Record<string, string> = {
    'Active': 'active',
    'Active With Contingencies': 'active_contingency',
    'Pending': 'pending',
    'Under Contract': 'pending',
    'Closed': 'sold',
    'Expired': 'expired',
    'Withdrawn': 'withdrawn',
    'Back On Market': 'active',
  };
  return statusMap[sparkStatus] || sparkStatus?.toLowerCase() || 'active';
}

// Extract features from listing
function extractFeatures(listing: SparkListing): string[] {
  const features: string[] = [];

  if (listing.PoolFeature === 'Yes' || listing.PoolFeature === true) features.push('pool');
  if (listing.GarageSpaces && parseInt(listing.GarageSpaces) > 0) features.push('garage');
  if (listing.WaterfrontFeature === 'Yes' || listing.WaterfrontFeature === true) features.push('waterfront');
  if (listing.FireplaceNumber && parseInt(listing.FireplaceNumber) > 0) features.push('fireplace');
  if (listing.Basement === 'Yes' || listing.Basement === true) features.push('basement');
  if (listing.SolarPowerSystem === 'Yes') features.push('solar');
  if (listing.HotTubSpaSpa === 'Yes' || listing.HotTubSpaSpa === true) features.push('spa');
  if (listing.View === 'Water View' || listing.View === 'Mountain View') features.push('view');
  if (listing.RVParking === 'Yes' || listing.RVParking === true) features.push('rv_parking');

  return features;
}

// Build property data from Spark listing
function buildPropertyData(listing: SparkListing): PropertyData {
  const data: PropertyData = {
    external_listing_id: listing.ListingKey || listing.Id,
    mls_number: listing.ListingKey || listing.Id,
    address: listing.UnparsedAddress || `${listing.StreetNumber || ''} ${listing.StreetName || ''}`.trim(),
    city: listing.City,
    state: listing.StateOrProvince,
    zip_code: listing.PostalCode,
    county: listing.County,
    subdivision: listing.SubdivisionName,
    lat: listing.Latitude ? parseFloat(listing.Latitude) : null,
    lng: listing.Longitude ? parseFloat(listing.Longitude) : null,
    price: listing.ListPrice ? parseInt(listing.ListPrice) : null,
    beds: listing.BedroomsTotal ? parseInt(listing.BedroomsTotal) : null,
    baths: listing.BathroomsTotalInteger ? parseFloat(listing.BathroomsTotalInteger) : null,
    sqft: listing.LivingArea ? parseInt(listing.LivingArea) : null,
    lot_size: listing.LotSizeAcres ? parseFloat(listing.LotSizeAcres) : null,
    year_built: listing.YearBuilt ? parseInt(listing.YearBuilt) : null,
    property_type: mapPropertyType(listing.PropertyType),
    features: extractFeatures(listing),
    images: (listing.Photos || []).map((photo: any) => ({
      url: photo.MediaURL || photo.url,
      caption: photo.Caption || '',
    })),
    status: mapStatus(listing.ListingStatus),
    list_price: listing.ListPrice ? parseInt(listing.ListPrice) : null,
    list_date: listing.ListingContractDate || listing.ListDate,
    days_on_market: listing.DaysOnMarket ? parseInt(listing.DaysOnMarket) : null,
    private_pool: listing.PoolPrivateYN === true || listing.PoolPrivateYN === 'Y',
    rv_garage: listing.RVParking === 'Yes' || listing.RVParking === true,
    single_story: listing.Stories === 1 || listing.Stories === '1',
    horse_property: listing.AnimalFacilities === 'Horses' || listing.AnimalFacilities?.includes('Horse'),
    corner_lot: listing.LotPosition === 'Corner' || listing.LotPosition?.includes('Corner'),
    cul_de_sac: listing.LotPosition === 'Cul de Sac' || listing.LotPosition?.includes('Cul de Sac'),
    waterfront: listing.WaterfrontFeature === 'Yes' || listing.WaterfrontFeature === true,
    golf_course_lot: listing.LotPosition?.includes('Golf Course'),
    community_pool: listing.PoolFeature === 'Community',
    gated_community: listing.CommunityFeatures?.includes('Gated') || listing.GatedCommunity === 'Y',
    hoa_required: listing.AssociationFeeFreq ? true : false,
    age_restricted_55plus: listing.AgeRestricted === '55+' || listing.AgeRestricted === true,
    casita_guest_house: listing.RoomType?.includes('Casita') || listing.RoomType?.includes('Guest House'),
    office_den: listing.OfficeNook === 'Yes' || listing.DenOfficeLibrary === 'Yes',
    basement: listing.Basement === 'Yes' || listing.Basement === true,
    open_floor_plan: listing.OpenPorch === 'Yes' || listing.OpenPorch === true,
    recently_remodeled: listing.RemodelYear ? (new Date().getFullYear() - parseInt(listing.RemodelYear) < 5) : false,
    energy_efficient: listing.GreenIndication === 'Yes' || listing.GreenIndication === true,
    solar_owned: listing.SolarPowerSystem === 'Yes' && listing.SolarPowerSystemCompanyName?.length > 0,
    solar_leased: listing.SolarPowerSystem === 'Leased',
    spa_hot_tub: listing.HotTubSpaSpa === 'Yes' || listing.HotTubSpaSpa === true,
    has_view: listing.View && listing.View !== 'None',
    is_featured: listing.isFeatured || false,
    open_house_date: listing.OpenHouseDate,
    open_house_end: listing.OpenHouseEndDateTime,
    open_house_remarks: listing.OpenHouseRemarks,
    schools: listing.ElementarySchool ? [listing.ElementarySchool, listing.MiddleSchool, listing.HighSchool].filter(Boolean) : [],
    updated_at: new Date().toISOString(),
  };

  // Filter out null/undefined values
  return Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== null && v !== undefined)
  );
}

// Retry with exponential backoff
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 3
): Promise<Response> {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (response.status === 429) {
        const waitTime = Math.pow(2, i) * 1000;
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${i + 1}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      const waitTime = Math.pow(2, i) * 1000;
      console.log(`Fetch error, retrying in ${waitTime}ms:`, error);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // Admin only or automation
    const user = await getUser(req);
    if (user && !user.is_admin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const supabase = getServiceClient();
    const sparkAccessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');

    if (!sparkAccessToken) {
      return jsonResponse(
        { error: 'Spark API token not configured' },
        400
      );
    }

    // Load cursor from sync_cache table
    const { data: cacheEntry } = await supabase
      .from('sync_cache')
      .select('value')
      .eq('key', 'spark_api_pagination')
      .single();

    let cursor = cacheEntry?.value || null;
    const cursorFrom = cursor;

    // Fetch listings modified since last sync
    let query = 'https://api.sparkplatform.com/v1/listings?pageSize=500&_filter=ListModificationTimestamp>=';

    if (!cursor) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      cursor = thirtyDaysAgo.toISOString().split('T')[0];
    }

    query += cursor;

    let totalFetched = 0;
    let newListings = 0;
    let updatedListings = 0;
    let skipped = 0;
    let cursorTo = cursor;

    const headers = {
      'Authorization': `Bearer ${sparkAccessToken}`,
      'Content-Type': 'application/json',
    };

    let hasMore = true;
    let pageUrl = query;

    while (hasMore) {
      const response = await fetchWithRetry(pageUrl, headers);

      if (!response.ok) {
        console.error('Spark API error:', response.status, await response.text());
        return jsonResponse(
          { error: `Spark API error: ${response.status}` },
          400
        );
      }

      const data = await response.json();
      const listings: SparkListing[] = data.D?.Results || data.listings || [];

      if (listings.length === 0) {
        hasMore = false;
        break;
      }

      // Process listings batch
      for (const listing of listings) {
        try {
          const propertyData = buildPropertyData(listing);

          if (!propertyData.external_listing_id) {
            skipped++;
            continue;
          }

          // Upsert using external_listing_id
          const { error: upsertError, data: upsertData } = await supabase
            .from('properties')
            .upsert(propertyData, { onConflict: 'external_listing_id' });

          if (upsertError) {
            console.error('Upsert error for listing', propertyData.external_listing_id, upsertError);
            skipped++;
          } else {
            totalFetched++;
            if (upsertData && upsertData.length > 0) {
              newListings++;
            } else {
              updatedListings++;
            }
          }

          // Update cursor
          if (listing.ListModificationTimestamp) {
            cursorTo = listing.ListModificationTimestamp;
          }
        } catch (error) {
          console.error('Error processing listing:', error);
          skipped++;
        }
      }

      // Check for next page
      const nextLink = data.D?.Links?.find((l: any) => l.rel === 'next');
      if (nextLink && nextLink.href) {
        pageUrl = nextLink.href;
      } else {
        hasMore = false;
      }
    }

    // Save cursor after batch
    const { error: cacheError } = await supabase
      .from('sync_cache')
      .upsert(
        { key: 'spark_api_pagination', value: cursorTo },
        { onConflict: 'key' }
      );

    if (cacheError) {
      console.error('Failed to update cursor:', cacheError);
    }

    return jsonResponse({
      success: true,
      total_fetched: totalFetched,
      new_listings: newListings,
      updated_listings: updatedListings,
      skipped,
      cursor_from: cursorFrom,
      cursor_to: cursorTo,
    });
  } catch (error) {
    console.error('Error in syncSparkApiListings:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
