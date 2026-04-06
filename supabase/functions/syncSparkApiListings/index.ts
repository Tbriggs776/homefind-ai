import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

// ─── Configuration ──────────────────────────────────────────────────────────
const SPARK_REPL_BASE = 'https://replication.sparkapi.com/v1';
const DB_BATCH_SIZE = 200;
const SPARK_PAGE_SIZE = 1000;
const MAX_PAGES = 300;
const TANNER_AGENT_ID = 'pc295';

// ─── Spark multi-select field helper ────────────────────────────────────────
// Spark returns multi-select fields as associative arrays: { "Private": true, "Heated": true }
// This converts them to readable text for regex matching and display
function sparkFieldToText(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(' ');
  if (typeof val === 'object') return Object.keys(val).join(' ');
  return String(val);
}

// ─── Map Spark PropertyType + PropertySubType to normalized types ────────────
// Per Spark docs: PropertyType "A" = Residential, PropertySubType "SF" = Single Family, "CD" = Condo, etc.
function mapPropertyType(propertyType: string | undefined, subType: string | undefined): string {
  if (!subType && !propertyType) return 'single_family';
  const s = (subType || '').toLowerCase();
  const p = (propertyType || '').toUpperCase();
  if (s.includes('sf') || s.includes('single family') || s === 'single family - detached') return 'single_family';
  if (s.includes('cd') || s.includes('condo') || s.includes('condominium')) return 'condo';
  if (s.includes('th') || s.includes('townhouse') || s.includes('townhome')) return 'townhouse';
  if (s.includes('mf') || s.includes('multi') || s.includes('duplex') || s.includes('triplex') || s.includes('fourplex')) return 'multi_family';
  if (s.includes('land') || s.includes('lot') || s.includes('vacant') || p === 'E') return 'land';
  if (p === 'A' || p === 'B') return 'single_family';
  return 'single_family';
}

// ─── Map MlsStatus to frontend-friendly status ─────────────────────────────
function mapStatus(mlsStatus: string | undefined): string {
  if (!mlsStatus) return 'active';
  const s = mlsStatus.toLowerCase();
  if (s.includes('pending') || s === 'p') return 'pending';
  if (s.includes('ucb') || s.includes('under contract')) return 'pending';
  if (s.includes('ccbs') || s.includes('contingent')) return 'pending';
  if (s.includes('closed') || s.includes('sold') || s === 's') return 'sold';
  if (s.includes('coming soon') || s === 'cs') return 'coming_soon';
  if (s.includes('active') || s === 'a') return 'active';
  return 'active';
}

// ─── Extract structured features array from Spark fields ────────────────────
function extractFeatures(d: any): string[] {
  const features: string[] = [];
  const poolText = sparkFieldToText(d.PoolFeatures).toLowerCase();
  if (poolText.includes('pool') || poolText.includes('private') || poolText.includes('heated')) features.push('Pool');
  if ((parseInt(d.GarageSpaces) || 0) > 0) features.push(`${d.GarageSpaces}-Car Garage`);
  if (d.WaterfrontYN === true || d.WaterfrontYN === 'Yes') features.push('Waterfront');
  if ((parseInt(d.FireplacesTotal) || 0) > 0) features.push('Fireplace');
  const basementText = sparkFieldToText(d.Basement).toLowerCase();
  if (basementText && basementText !== 'none' && basementText !== 'no') features.push('Basement');
  if (d.PatioAndPorchFeatures && sparkFieldToText(d.PatioAndPorchFeatures)) features.push('Patio');
  if (d.Cooling) features.push('Central Air');
  const flooringText = sparkFieldToText(d.Flooring).toLowerCase();
  if (flooringText.includes('hardwood')) features.push('Hardwood Floors');
  const parkingStr = [sparkFieldToText(d.ParkingFeatures), typeof d.PublicRemarks === 'string' ? d.PublicRemarks : ''].join(' ').toLowerCase();
  if (/rv garage|rv gate|rv parking|rv access/.test(parkingStr)) features.push('RV Garage');
  const spaText = sparkFieldToText(d.SpaFeatures).toLowerCase();
  if (d.SpaYN === true || d.SpaYN === 'Yes' || spaText.includes('spa') || spaText.includes('hot tub')) features.push('Spa/Hot Tub');
  const viewText = sparkFieldToText(d.View).toLowerCase();
  if (d.ViewYN === true || d.ViewYN === 'Yes' || viewText) features.push('View');
  return features;
}

// ─── Extract next upcoming open house ───────────────────────────────────────
function extractOpenHouse(d: any): { open_house_date: string | null; open_house_end: string | null; open_house_remarks: string | null } {
  if (!Array.isArray(d.OpenHouses) || d.OpenHouses.length === 0) {
    return { open_house_date: null, open_house_end: null, open_house_remarks: null };
  }
  const now = new Date();
  const future = d.OpenHouses
    .filter((oh: any) => { const s = oh.StartTime || oh.Date; return s && new Date(s) >= now; })
    .sort((a: any, b: any) => new Date(a.StartTime || a.Date).getTime() - new Date(b.StartTime || b.Date).getTime());
  if (future.length === 0) return { open_house_date: null, open_house_end: null, open_house_remarks: null };
  const next = future[0];
  return {
    open_house_date: next.StartTime || next.Date || null,
    open_house_end: next.EndTime || null,
    open_house_remarks: next.Comments || next.Remarks || null,
  };
}

// ─── Build full property DB row from a single Spark listing ─────────────────
function buildPropertyRow(listing: any) {
  const d = listing.StandardFields || listing;
  const externalId = String(listing.Id || d.ListingKey || '');
  const listPrice = parseFloat(d.ListPrice || d.CurrentPrice) || 0;

  // Skip listings under $50k (likely erroneous or non-residential)
  if (listPrice < 50000) return null;

  // ── Photos: Collect ALL from Photos expansion ──
  // Per Spark docs, Photos expansion returns array with Uri1024, Uri800, UriLarge, Uri640, Uri300
  const images: string[] = [];
  let primaryPhotoUrl: string | null = null;
  if (Array.isArray(d.Photos)) {
    for (const photo of d.Photos) {
      const url = photo.Uri1024 || photo.Uri800 || photo.UriLarge || photo.Uri640 || photo.Uri300;
      if (url) images.push(url);
      if (photo.Primary && !primaryPhotoUrl) primaryPhotoUrl = url || null;
    }
  }
  if (images.length === 0) return null; // Skip listings with no photos
  if (!primaryPhotoUrl) primaryPhotoUrl = images[0];

  // ── Address ──
  const addressParts = [d.StreetNumber, d.StreetDirPrefix, d.StreetName, d.StreetSuffix, d.StreetDirSuffix].filter(Boolean).join(' ');
  const unitPart = d.UnitNumber ? `, Unit ${d.UnitNumber}` : '';
  const address = (addressParts || d.UnparsedAddress || 'Address Not Available') + unitPart;

  // ── Full text blob for regex feature detection ──
  const allText = [
    d.PublicRemarks, sparkFieldToText(d.CommunityFeatures), sparkFieldToText(d.InteriorFeatures),
    sparkFieldToText(d.ExteriorFeatures), sparkFieldToText(d.ParkingFeatures), sparkFieldToText(d.OtherStructures),
    sparkFieldToText(d.ArchitecturalStyle), sparkFieldToText(d.PropertyCondition), sparkFieldToText(d.PoolFeatures),
    sparkFieldToText(d.GreenEnergyEfficient), sparkFieldToText(d.GreenEnergyGeneration), sparkFieldToText(d.LotFeatures),
    sparkFieldToText(d.Basement), sparkFieldToText(d.PatioAndPorchFeatures), sparkFieldToText(d.SpaFeatures),
  ].filter(Boolean).join(' ').toLowerCase();

  const lotFeaturesText = sparkFieldToText(d.LotFeatures).toLowerCase();
  const communityText = sparkFieldToText(d.CommunityFeatures).toLowerCase();
  const poolText = sparkFieldToText(d.PoolFeatures).toLowerCase();
  const stories = parseFloat(d.Stories || d.Levels || '0');
  const spaText = sparkFieldToText(d.SpaFeatures).toLowerCase();
  const viewText = sparkFieldToText(d.View).toLowerCase();

  // ── HOA ──
  const assocVal = String(d.AssociationYN || '').toLowerCase();
  const hasAssociation = assocVal === 'true' || assocVal === 'yes' || assocVal === 'y' || d.AssociationYN === true || (parseFloat(d.AssociationFee) > 0);

  // ── Featured: Tanner's listings ──
  const agentId = (d.ListAgentMlsId || '').toLowerCase();
  const coAgentId = (d.CoListAgentMlsId || '').toLowerCase();
  const isFeatured = agentId === TANNER_AGENT_ID || coAgentId === TANNER_AGENT_ID;

  // ── Virtual tour ──
  let virtualTourUrl = d.VirtualTourURLUnbranded || '';
  if (!virtualTourUrl && Array.isArray(d.VirtualTours)) {
    const tour = d.VirtualTours.find((t: any) => t.Uri || t.Url);
    if (tour) virtualTourUrl = tour.Uri || tour.Url || '';
  }

  // ── Bathrooms: Full + Half*0.5 (more accurate than BathsTotal) ──
  const bathrooms = (parseFloat(d.BathsFull) || 0) + (parseFloat(d.BathsHalf) || 0) * 0.5;
  const bathroomsFinal = bathrooms || parseFloat(d.BathsTotal || d.BathroomsTotalInteger) || 0;

  // ── MLS status ──
  const mlsStatus = d.MlsStatus || d.StandardStatus || 'Active';
  const status = mapStatus(mlsStatus);

  return {
    // Identifiers
    mls_number: String(d.ListingId || externalId),
    listing_key: externalId,
    external_listing_id: externalId,
    listing_source: 'flexmls_idx',

    // Status — dual columns for frontend (status) and edge functions (mls_status)
    status,
    mls_status: mlsStatus,

    // Location
    address,
    city: d.City || d.PostalCity || '',
    state: d.StateOrProvince || 'AZ',
    zip_code: d.PostalCode || '',
    county: d.CountyOrParish || '',
    subdivision: d.SubdivisionName || '',
    cross_street: d.CrossStreet || '',
    latitude: parseFloat(d.Latitude) || null,
    longitude: parseFloat(d.Longitude) || null,

    // Pricing — dual columns for frontend (price) and edge functions (list_price)
    price: listPrice,
    list_price: listPrice,
    original_list_price: parseFloat(d.OriginalListPrice) || null,
    previous_list_price: parseFloat(d.PreviousListPrice) || null,
    price_change_date: d.PriceChangeTimestamp || null,

    // Property details
    bedrooms: parseInt(d.BedsTotal) || 0,
    bathrooms: bathroomsFinal,
    square_feet: parseInt(d.BuildingAreaTotal || d.LivingArea || '0') || 0,
    lot_size: parseFloat(d.LotSizeAcres || '0') || null,
    year_built: parseInt(d.YearBuilt || '0') || null,
    property_type: mapPropertyType(d.PropertyType, d.PropertySubType),
    garage_spaces: parseInt(d.GarageSpaces || '0') || 0,
    days_on_market: parseInt(d.CumulativeDaysOnMarket || d.DaysOnMarket || '0') || 0,

    // Dates
    listing_date: d.OriginalEntryTimestamp || d.ListingContractDate || d.OnMarketDate || null,
    modification_timestamp: d.ModificationTimestamp || null,

    // Description & media
    description: d.PublicRemarks || '',
    images,
    primary_photo_url: primaryPhotoUrl,
    photo_count: images.length,
    virtual_tour_url: virtualTourUrl || null,
    has_virtual_tour: !!virtualTourUrl,
    features: extractFeatures(d),

    // Boolean property flags for search filters
    private_pool: poolText.includes('private') || poolText.includes('pool') || allText.includes('private pool'),
    rv_garage: /rv garage|rv parking|rv gate|rv access|rv bay|oversized rv|pull.?through rv|rv height|motorhome garage|toy hauler|rv parking pad|gated rv|rv side yard|rv driveway|rv hookup|rv storage|rv friendly|room for rv|rv accessible/.test(allText),
    single_story: stories === 1 || allText.includes('single level') || allText.includes('single story') || allText.includes('one level'),
    horse_property: allText.includes('horse') || allText.includes('equestrian'),
    corner_lot: lotFeaturesText.includes('corner') || allText.includes('corner lot'),
    cul_de_sac: /cul.?de.?sac/.test(lotFeaturesText) || /cul.?de.?sac/.test(allText),
    waterfront: d.WaterfrontYN === true || d.WaterfrontYN === 'Yes' || allText.includes('waterfront') || allText.includes('lakefront'),
    golf_course_lot: lotFeaturesText.includes('golf') || allText.includes('golf course') || communityText.includes('golf'),
    community_pool: communityText.includes('pool') || communityText.includes('community pool'),
    gated_community: communityText.includes('gated') || allText.includes('gated community') || allText.includes('gated entrance'),
    age_restricted_55plus: d.SeniorCommunityYN === true || d.SeniorCommunityYN === 'Yes' || allText.includes('55+') || allText.includes('55 and older') || allText.includes('senior community') || allText.includes('age restricted') || communityText.includes('55+'),
    casita_guest_house: /casita|guest house|guest quarters|accessory dwelling|adu|in.?law suite|mother.?in.?law|multigenerational|next.?gen suite|private guest suite|detached guest|secondary living|garage apartment|carriage house|granny flat|backyard cottage/.test(allText),
    office_den: allText.includes('office') || allText.includes(' den') || allText.includes('bonus room') || allText.includes('study'),
    basement: !!d.Basement && sparkFieldToText(d.Basement).toLowerCase() !== 'none' && sparkFieldToText(d.Basement).toLowerCase() !== 'no',
    open_floor_plan: /open floor plan|open concept|great room floor|open great room|open living concept|seamless living|expansive great room|open kitchen living/.test(allText),
    recently_remodeled: /updated kitchen|updated bathroom|modern updates|upgraded kitchen|upgraded bathroom|new flooring|fresh paint|new countertop|quartz countertop|granite countertop|remodel|renovated|renovation/.test(allText),
    energy_efficient: /energy efficient|energy saving|dual pane|low.?e windows|tankless water heater|high efficiency|energy star|led lighting|smart thermostat|ev charger/.test(allText) || !!d.GreenEnergyEfficient,
    solar_owned: /solar owned|owned solar|solar energy system/.test(allText) || (allText.includes('solar') && allText.includes('owned')),
    solar_leased: /solar lease|leased solar/.test(allText) || (allText.includes('solar') && allText.includes('lease')),
    spa_hot_tub: d.SpaYN === true || d.SpaYN === 'Yes' || spaText.includes('spa') || spaText.includes('hot tub') || allText.includes('hot tub') || allText.includes(' spa'),
    has_view: d.ViewYN === true || d.ViewYN === 'Yes' || !!viewText,
    view_description: sparkFieldToText(d.View) || '',

    // HOA
    hoa_required: hasAssociation,
    hoa_fee: parseFloat(d.AssociationFee) || null,
    hoa_fee_frequency: d.AssociationFeeFrequency || '',

    // Tax
    tax_annual_amount: parseFloat(d.TaxAnnualAmount) || null,

    // Schools
    elementary_school: d.ElementarySchool || '',
    middle_school: d.MiddleOrJuniorSchool || '',
    high_school: d.HighSchool || '',

    // Agent & Office — ARMLS Rule 23.2.12 compliance
    list_agent_mls_id: d.ListAgentMlsId || '',
    list_office_name: d.ListOfficeName || '',
    listing_office_name: d.ListOfficeName || '',
    listing_office_mls_id: d.ListOfficeKey || d.ListOfficeMlsId || '',
    listing_agent_name: d.ListAgentFullName || [d.ListAgentFirstName, d.ListAgentLastName].filter(Boolean).join(' ') || '',
    listing_agent_email: d.ListAgentEmail || '',
    listing_agent_phone: d.ListAgentDirectPhone || d.ListAgentOfficePhone || d.ListAgentPreferredPhone || '',
    listing_agent_mls_id: d.ListAgentMlsId || '',

    // Featured
    is_featured: isFeatured,

    // Open house
    ...extractOpenHouse(d),
  };
}

// ─── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    const body = await req.json().catch(() => ({}));
    const fullSync = body.full_sync === true;

    // Load sync cursor
    const { data: cache } = await supabaseAdmin
      .from('sync_cache')
      .select('cache_value')
      .eq('cache_key', 'spark_last_sync')
      .single();

    const lastSync = (!fullSync && cache?.cache_value?.timestamp) || '';
    const syncStartTime = new Date().toISOString();

    console.log(`[Sync] Starting ${fullSync ? 'FULL' : 'incremental'} sync. Last: ${lastSync || 'never'}`);

    // Spark field selection — reduces payload per replication docs recommendation
    const selectFields = [
      'ListingKey','ListingId','MlsStatus','StandardStatus','PropertyType','PropertySubType',
      'StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','StreetDirSuffix','UnitNumber','UnparsedAddress',
      'City','PostalCity','StateOrProvince','PostalCode','CountyOrParish','SubdivisionName','CrossStreet',
      'Latitude','Longitude',
      'ListPrice','CurrentPrice','OriginalListPrice','PreviousListPrice','PriceChangeTimestamp',
      'BedsTotal','BathsFull','BathsHalf','BathsTotal','BathroomsTotalInteger',
      'BuildingAreaTotal','LivingArea','LotSizeAcres','LotSizeSquareFeet','YearBuilt',
      'PublicRemarks','CumulativeDaysOnMarket','DaysOnMarket',
      'ModificationTimestamp','ListingContractDate','OnMarketDate','OriginalEntryTimestamp',
      'PoolFeatures','GarageSpaces','WaterfrontYN','FireplacesTotal',
      'Basement','PatioAndPorchFeatures','Cooling','Flooring','ParkingFeatures','LotFeatures',
      'Stories','Levels','AssociationYN','AssociationFee','AssociationFeeFrequency',
      'CommunityFeatures','SeniorCommunityYN',
      'GreenEnergyEfficient','GreenEnergyGeneration',
      'OtherStructures','ArchitecturalStyle','InteriorFeatures','ExteriorFeatures',
      'PropertyCondition','SpaFeatures','SpaYN','View','ViewYN',
      'TaxAnnualAmount',
      'ElementarySchool','MiddleOrJuniorSchool','HighSchool',
      'VirtualTourURLUnbranded',
      'ListAgentMlsId','CoListAgentMlsId','ListAgentFullName','ListAgentFirstName','ListAgentLastName',
      'ListAgentEmail','ListAgentDirectPhone','ListAgentOfficePhone','ListAgentPreferredPhone',
      'ListOfficeName','ListOfficeKey','ListOfficeMlsId',
    ].join(',');

    // IDX filter: Active residential only (ARMLS Rule 23.3.5 prohibits Coming Soon/expired/cancelled)
    let sparkFilter = `MlsStatus Eq 'Active' And PropertyType Eq 'A'`;
    if (lastSync) {
      sparkFilter += ` And ModificationTimestamp Gt ${lastSync}`;
    }

    let totalSynced = 0;
    let totalSkipped = 0;
    let skipToken = '';
    let page = 0;

    while (page < MAX_PAGES) {
      // Per Spark Replication docs: _skiptoken for pagination, _limit max 1000
      let url = `${SPARK_REPL_BASE}/listings?_limit=${SPARK_PAGE_SIZE}` +
        `&_filter=${encodeURIComponent(sparkFilter)}` +
        `&_orderby=ModificationTimestamp` +
        `&_expand=Photos,VirtualTours,OpenHouses` +
        `&_select=${selectFields}`;

      if (skipToken) url += `&_skiptoken=${skipToken}`;

      console.log(`[Sync] Page ${page + 1}: fetching...`);

      const sparkRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'HomeFind-AI/1.0 (Supabase Edge Function)',
        },
      });

      if (sparkRes.status === 429) {
        console.log('[Sync] Rate limited (429) — saving progress and stopping');
        break;
      }

      if (!sparkRes.ok) {
        const errText = await sparkRes.text();
        throw new Error(`Spark API ${sparkRes.status}: ${errText.slice(0, 500)}`);
      }

      const sparkData = await sparkRes.json();
      const listings = sparkData?.D?.Results || [];

      if (listings.length === 0) {
        console.log('[Sync] No more listings — complete');
        break;
      }

      // Map to DB rows
      const rows = listings.map((l: any) => buildPropertyRow(l)).filter(Boolean);
      totalSkipped += (listings.length - rows.length);

      // Upsert in batches
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
          const batch = rows.slice(i, i + DB_BATCH_SIZE);
          const { error } = await supabaseAdmin
            .from('properties')
            .upsert(batch, { onConflict: 'mls_number' });
          if (error) {
            console.error(`[Sync] Upsert error batch ${i}:`, error.message);
            throw error;
          }
          totalSynced += batch.length;
        }
      }

      console.log(`[Sync] Page ${page + 1}: ${listings.length} fetched, ${rows.length} upserted, ${listings.length - rows.length} skipped`);

      // Pagination via _skiptoken per Spark replication docs
      const nextLink = sparkData?.D?.Pagination?.['@odata.nextLink'] || '';
      if (nextLink) {
        try {
          const nextUrl = new URL(nextLink.startsWith('http') ? nextLink : `https://replication.sparkapi.com${nextLink}`);
          skipToken = nextUrl.searchParams.get('_skiptoken') || '';
        } catch {
          skipToken = '';
        }
      } else {
        skipToken = '';
      }

      if (!skipToken) {
        console.log('[Sync] No more pages — complete');
        break;
      }
      page++;
    }

    // Save sync cursor
    await supabaseAdmin.from('sync_cache').upsert({
      cache_key: 'spark_last_sync',
      cache_value: {
        timestamp: syncStartTime,
        listings_synced: totalSynced,
        listings_skipped: totalSkipped,
        pages: page + 1,
        full_sync: fullSync,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });

    // Get total count
    const { count } = await supabaseAdmin
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    console.log(`[Sync] Done: ${totalSynced} synced, ${totalSkipped} skipped, ${count} total active`);

    return jsonResponse({
      success: true,
      synced: totalSynced,
      skipped: totalSkipped,
      pages: page + 1,
      total_active_listings: count,
      sync_type: fullSync ? 'full' : 'incremental',
    });

  } catch (err: any) {
    console.error('[Sync] Error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
