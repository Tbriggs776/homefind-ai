import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * syncSparkApiListings — Spark Replication API sync for HomeFind AI
 *
 * Follows the 3-step Spark Replication process exactly:
 *   Step 1: Initial download (full_sync=true) — no filter, _skiptoken pagination
 *   Step 2: Incremental updates — ModificationTimestamp bt START,END (both bounds required per docs)
 *   Step 3: Purge stale data — handled by separate checkInactiveListings function
 *
 * Architecture:
 *   - Each invocation processes up to MAX_PAGES of data (within the ~60s Edge Function timeout)
 *   - Saves cursor (_skiptoken + timestamps) to sync_cache after each page
 *   - Cron calls this function every 10 minutes; function picks up where it left off
 *   - Once caught up (no more pages), it marks sync as complete and goes idle until next window
 *
 * Per Spark docs:
 *   - Replication endpoint: https://replication.sparkapi.com/v1
 *   - _skiptoken pagination (NOT _skip) for consistent ordering
 *   - _limit max 1000 for replication keys
 *   - Always use two timestamps with ModificationTimestamp (bt or gt+lt) to avoid caching errors
 *   - Use _select to minimize payload, _expand for subresources
 */

const SPARK_REPL = 'https://replication.sparkapi.com/v1';
const DB_BATCH = 200;
const SPARK_LIMIT = 1000;
const MAX_PAGES = 50;  // ~50 pages per invocation = ~50k listings, well within 60s timeout
const TANNER_ID = 'pc295';
const CURSOR_KEY = 'spark_sync_cursor';

// ─── Spark multi-select field → text (handles { "Private": true } format) ───
function sft(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(' ');
  if (typeof val === 'object') return Object.keys(val).join(' ');
  return String(val);
}

// ─── PropertyType + SubType → normalized type ───────────────────────────────
// Spark: PropertyType "A"=Residential, PropertySubType "SF"=Single Family, "CD"=Condo
function mapType(pt: string | undefined, pst: string | undefined): string {
  const s = (pst || '').toLowerCase();
  if (s.includes('sf') || s.includes('single family')) return 'single_family';
  if (s.includes('cd') || s.includes('condo')) return 'condo';
  if (s.includes('th') || s.includes('townhouse') || s.includes('townhome')) return 'townhouse';
  if (s.includes('mf') || s.includes('multi') || s.includes('duplex') || s.includes('triplex')) return 'multi_family';
  if (s.includes('land') || s.includes('lot') || s.includes('vacant')) return 'land';
  return (pt || '').toUpperCase() === 'A' ? 'single_family' : 'single_family';
}

// ─── MlsStatus → frontend status ───────────────────────────────────────────
function mapStatus(ms: string | undefined): string {
  if (!ms) return 'active';
  const s = ms.toLowerCase();
  if (s.includes('active') || s === 'a') return 'active';
  if (s.includes('pending') || s.includes('ucb') || s.includes('under contract') || s.includes('ccbs')) return 'pending';
  if (s.includes('sold') || s.includes('closed')) return 'sold';
  if (s.includes('coming soon')) return 'coming_soon';
  return 'active';
}

// ─── Extract features from Spark fields ─────────────────────────────────────
function extractFeatures(d: any): string[] {
  const f: string[] = [];
  const pool = sft(d.PoolFeatures).toLowerCase();
  if (pool.includes('pool') || pool.includes('private') || pool.includes('heated')) f.push('Pool');
  if ((parseInt(d.GarageSpaces) || 0) > 0) f.push(`${d.GarageSpaces}-Car Garage`);
  if (d.WaterfrontYN === true || d.WaterfrontYN === 'Yes') f.push('Waterfront');
  if ((parseInt(d.FireplacesTotal) || 0) > 0) f.push('Fireplace');
  const bsmt = sft(d.Basement).toLowerCase();
  if (bsmt && bsmt !== 'none' && bsmt !== 'no') f.push('Basement');
  if (d.PatioAndPorchFeatures && sft(d.PatioAndPorchFeatures)) f.push('Patio');
  if (d.Cooling) f.push('Central Air');
  if (sft(d.Flooring).toLowerCase().includes('hardwood')) f.push('Hardwood Floors');
  if (/rv garage|rv gate|rv parking|rv access/.test([sft(d.ParkingFeatures), d.PublicRemarks || ''].join(' ').toLowerCase())) f.push('RV Garage');
  const spa = sft(d.SpaFeatures).toLowerCase();
  if (d.SpaYN === true || d.SpaYN === 'Yes' || spa.includes('spa') || spa.includes('hot tub')) f.push('Spa/Hot Tub');
  if (d.ViewYN === true || d.ViewYN === 'Yes' || sft(d.View)) f.push('View');
  return f;
}

// ─── Extract next upcoming open house ───────────────────────────────────────
function extractOH(d: any) {
  const nil = { open_house_date: null, open_house_end: null, open_house_remarks: null };
  if (!Array.isArray(d.OpenHouses) || !d.OpenHouses.length) return nil;
  const now = new Date();
  const future = d.OpenHouses
    .filter((o: any) => { const s = o.StartTime || o.Date; return s && new Date(s) >= now; })
    .sort((a: any, b: any) => new Date(a.StartTime || a.Date).getTime() - new Date(b.StartTime || b.Date).getTime());
  if (!future.length) return nil;
  const n = future[0];
  return { open_house_date: n.StartTime || n.Date || null, open_house_end: n.EndTime || null, open_house_remarks: n.Comments || n.Remarks || null };
}

// ─── Build DB row from a single Spark listing ───────────────────────────────
function buildRow(listing: any) {
  const d = listing.StandardFields || listing;
  const extId = String(listing.Id || d.ListingKey || '');
  const price = parseFloat(d.ListPrice || d.CurrentPrice) || 0;
  if (price < 50000) return null;

  // Photos — collect all from Photos expansion
  const images: string[] = [];
  let primaryUrl: string | null = null;
  if (Array.isArray(d.Photos)) {
    for (const p of d.Photos) {
      const u = p.Uri1024 || p.Uri800 || p.UriLarge || p.Uri640 || p.Uri300;
      if (u) images.push(u);
      if (p.Primary && !primaryUrl) primaryUrl = u || null;
    }
  }
  if (!images.length) return null;
  if (!primaryUrl) primaryUrl = images[0];

  // Address
  const addr = [d.StreetNumber, d.StreetDirPrefix, d.StreetName, d.StreetSuffix, d.StreetDirSuffix].filter(Boolean).join(' ');
  const unit = d.UnitNumber ? `, Unit ${d.UnitNumber}` : '';
  const address = (addr || d.UnparsedAddress || 'Address Not Available') + unit;

  // Full text blob for regex feature detection
  const all = [d.PublicRemarks, sft(d.CommunityFeatures), sft(d.InteriorFeatures), sft(d.ExteriorFeatures),
    sft(d.ParkingFeatures), sft(d.OtherStructures), sft(d.ArchitecturalStyle), sft(d.PropertyCondition),
    sft(d.PoolFeatures), sft(d.GreenEnergyEfficient), sft(d.GreenEnergyGeneration), sft(d.LotFeatures),
    sft(d.Basement), sft(d.PatioAndPorchFeatures), sft(d.SpaFeatures)].filter(Boolean).join(' ').toLowerCase();

  const lotF = sft(d.LotFeatures).toLowerCase();
  const comF = sft(d.CommunityFeatures).toLowerCase();
  const poolF = sft(d.PoolFeatures).toLowerCase();
  const stories = parseFloat(d.Stories || d.Levels || '0');
  const assocYN = String(d.AssociationYN || '').toLowerCase();
  const hasHOA = assocYN === 'true' || assocYN === 'yes' || d.AssociationYN === true || (parseFloat(d.AssociationFee) > 0);
  const agentId = (d.ListAgentMlsId || '').toLowerCase();
  const coAgentId = (d.CoListAgentMlsId || '').toLowerCase();

  let vtUrl = d.VirtualTourURLUnbranded || '';
  if (!vtUrl && Array.isArray(d.VirtualTours)) {
    const t = d.VirtualTours.find((t: any) => t.Uri || t.Url);
    if (t) vtUrl = t.Uri || t.Url || '';
  }

  const baths = (parseFloat(d.BathsFull) || 0) + (parseFloat(d.BathsHalf) || 0) * 0.5;
  const mlsStatus = d.MlsStatus || d.StandardStatus || 'Active';

  return {
    mls_number: String(d.ListingId || extId),
    listing_key: extId,
    external_listing_id: extId,
    listing_source: 'flexmls_idx',
    status: mapStatus(mlsStatus),
    mls_status: mlsStatus,
    address, city: d.City || d.PostalCity || '', state: d.StateOrProvince || 'AZ',
    zip_code: d.PostalCode || '', county: d.CountyOrParish || '',
    subdivision: d.SubdivisionName || '', cross_street: d.CrossStreet || '',
    latitude: parseFloat(d.Latitude) || null, longitude: parseFloat(d.Longitude) || null,
    price, list_price: price,
    original_list_price: parseFloat(d.OriginalListPrice) || null,
    previous_list_price: parseFloat(d.PreviousListPrice) || null,
    price_change_date: d.PriceChangeTimestamp || null,
    bedrooms: parseInt(d.BedsTotal) || 0,
    bathrooms: baths || parseFloat(d.BathsTotal || d.BathroomsTotalInteger) || 0,
    square_feet: parseInt(d.BuildingAreaTotal || d.LivingArea || '0') || 0,
    lot_size: parseFloat(d.LotSizeAcres || '0') || null,
    year_built: parseInt(d.YearBuilt || '0') || null,
    property_type: mapType(d.PropertyType, d.PropertySubType),
    garage_spaces: parseInt(d.GarageSpaces || '0') || 0,
    days_on_market: parseInt(d.CumulativeDaysOnMarket || d.DaysOnMarket || '0') || 0,
    listing_date: d.OriginalEntryTimestamp || d.ListingContractDate || d.OnMarketDate || null,
    modification_timestamp: d.ModificationTimestamp || null,
    description: d.PublicRemarks || '',
    images, primary_photo_url: primaryUrl, photo_count: images.length,
    virtual_tour_url: vtUrl || null, has_virtual_tour: !!vtUrl,
    features: extractFeatures(d),
    // Boolean flags
    private_pool: poolF.includes('private') || poolF.includes('pool') || all.includes('private pool'),
    rv_garage: /rv garage|rv parking|rv gate|rv access|rv bay|oversized rv|pull.?through rv|motorhome garage|toy hauler|rv hookup|rv storage|rv friendly|room for rv/.test(all),
    single_story: stories === 1 || all.includes('single level') || all.includes('single story') || all.includes('one level'),
    horse_property: all.includes('horse') || all.includes('equestrian'),
    corner_lot: lotF.includes('corner') || all.includes('corner lot'),
    cul_de_sac: /cul.?de.?sac/.test(lotF) || /cul.?de.?sac/.test(all),
    waterfront: d.WaterfrontYN === true || d.WaterfrontYN === 'Yes' || all.includes('waterfront') || all.includes('lakefront'),
    golf_course_lot: lotF.includes('golf') || all.includes('golf course') || comF.includes('golf'),
    community_pool: comF.includes('pool') || comF.includes('community pool'),
    gated_community: comF.includes('gated') || all.includes('gated community') || all.includes('gated entrance'),
    age_restricted_55plus: d.SeniorCommunityYN === true || d.SeniorCommunityYN === 'Yes' || all.includes('55+') || all.includes('senior community') || all.includes('age restricted') || comF.includes('55+'),
    casita_guest_house: /casita|guest house|guest quarters|accessory dwelling|adu|in.?law suite|mother.?in.?law|multigenerational|next.?gen suite|detached guest|garage apartment|carriage house|granny flat|backyard cottage/.test(all),
    office_den: all.includes('office') || all.includes(' den') || all.includes('bonus room') || all.includes('study'),
    basement: !!d.Basement && sft(d.Basement).toLowerCase() !== 'none' && sft(d.Basement).toLowerCase() !== 'no',
    open_floor_plan: /open floor plan|open concept|great room floor|open great room|open living concept|seamless living|expansive great room|open kitchen living/.test(all),
    recently_remodeled: /updated kitchen|updated bathroom|modern updates|upgraded kitchen|upgraded bathroom|new flooring|fresh paint|new countertop|quartz countertop|granite countertop|remodel|renovated|renovation/.test(all),
    energy_efficient: /energy efficient|energy saving|dual pane|low.?e windows|tankless water heater|high efficiency|energy star|led lighting|smart thermostat|ev charger/.test(all) || !!d.GreenEnergyEfficient,
    solar_owned: /solar owned|owned solar|solar energy system/.test(all) || (all.includes('solar') && all.includes('owned')),
    solar_leased: /solar lease|leased solar/.test(all) || (all.includes('solar') && all.includes('lease')),
    spa_hot_tub: d.SpaYN === true || d.SpaYN === 'Yes' || sft(d.SpaFeatures).toLowerCase().includes('spa') || all.includes('hot tub'),
    has_view: d.ViewYN === true || d.ViewYN === 'Yes' || !!sft(d.View),
    view_description: sft(d.View) || '',
    hoa_required: hasHOA, hoa_fee: parseFloat(d.AssociationFee) || null,
    hoa_fee_frequency: d.AssociationFeeFrequency || '',
    tax_annual_amount: parseFloat(d.TaxAnnualAmount) || null,
    elementary_school: d.ElementarySchool || '', middle_school: d.MiddleOrJuniorSchool || '',
    high_school: d.HighSchool || '',
    // Agent & Office — ARMLS Rule 23.2.12
    list_agent_mls_id: d.ListAgentMlsId || '',
    list_office_name: d.ListOfficeName || '',
    listing_office_name: d.ListOfficeName || '',
    listing_office_mls_id: d.ListOfficeKey || d.ListOfficeMlsId || '',
    listing_agent_name: d.ListAgentFullName || [d.ListAgentFirstName, d.ListAgentLastName].filter(Boolean).join(' ') || '',
    listing_agent_email: d.ListAgentEmail || '',
    listing_agent_phone: d.ListAgentDirectPhone || d.ListAgentOfficePhone || d.ListAgentPreferredPhone || '',
    listing_agent_mls_id: d.ListAgentMlsId || '',
    is_featured: agentId === TANNER_ID || coAgentId === TANNER_ID,
    ...extractOH(d),
  };
}

// ─── Field selection for _select parameter ──────────────────────────────────
const SELECT = [
  'ListingKey','ListingId','MlsStatus','StandardStatus','PropertyType','PropertySubType',
  'StreetNumber','StreetDirPrefix','StreetName','StreetSuffix','StreetDirSuffix','UnitNumber','UnparsedAddress',
  'City','PostalCity','StateOrProvince','PostalCode','CountyOrParish','SubdivisionName','CrossStreet',
  'Latitude','Longitude','ListPrice','CurrentPrice','OriginalListPrice','PreviousListPrice','PriceChangeTimestamp',
  'BedsTotal','BathsFull','BathsHalf','BathsTotal','BathroomsTotalInteger',
  'BuildingAreaTotal','LivingArea','LotSizeAcres','YearBuilt',
  'PublicRemarks','CumulativeDaysOnMarket','DaysOnMarket',
  'ModificationTimestamp','ListingContractDate','OnMarketDate','OriginalEntryTimestamp',
  'PoolFeatures','GarageSpaces','WaterfrontYN','FireplacesTotal',
  'Basement','PatioAndPorchFeatures','Cooling','Flooring','ParkingFeatures','LotFeatures',
  'Stories','Levels','AssociationYN','AssociationFee','AssociationFeeFrequency',
  'CommunityFeatures','SeniorCommunityYN','GreenEnergyEfficient','GreenEnergyGeneration',
  'OtherStructures','ArchitecturalStyle','InteriorFeatures','ExteriorFeatures',
  'PropertyCondition','SpaFeatures','SpaYN','View','ViewYN','TaxAnnualAmount',
  'ElementarySchool','MiddleOrJuniorSchool','HighSchool','VirtualTourURLUnbranded',
  'ListAgentMlsId','CoListAgentMlsId','ListAgentFullName','ListAgentFirstName','ListAgentLastName',
  'ListAgentEmail','ListAgentDirectPhone','ListAgentOfficePhone','ListAgentPreferredPhone',
  'ListOfficeName','ListOfficeKey','ListOfficeMlsId',
].join(',');

// ─── Load / save cursor ─────────────────────────────────────────────────────
async function loadCursor() {
  const { data, error } = await supabaseAdmin
    .from('sync_cache')
    .select('cache_value')
    .eq('cache_key', CURSOR_KEY)
    .maybeSingle();
  if (error) {
    console.error('[Sync] loadCursor error:', error);
  }
  return data?.cache_value || {};
}
async function saveCursor(val: any) {
  const { error } = await supabaseAdmin.from('sync_cache').upsert(
    {
      cache_key: CURSOR_KEY,
      cache_value: val,
      sync_key: CURSOR_KEY, // safety net: legacy column is now nullable but we still populate it
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'cache_key' }
  );
  if (error) {
    console.error('[Sync] saveCursor FAILED:', error);
    throw new Error(`Failed to save sync cursor: ${error.message}`);
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!token) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    const body = await req.json().catch(() => ({}));
    const fullSync = body.full_sync === true;
    const cursor = await loadCursor();

    // ── Determine sync mode ──
    // full_sync=true OR no previous sync → Step 1: Initial Download (no filter)
    // Otherwise → Step 2: Incremental Update (ModificationTimestamp bt START,END)
    const isInitial = fullSync || !cursor.last_completed_sync;
    const skipToken = (!fullSync && cursor.skiptoken) || '';
    const now = new Date().toISOString();

    // For incremental: use the window from last completed sync to now
    // Per Spark docs: ALWAYS use both bounds to avoid server-side caching errors
    const windowStart = cursor.last_completed_sync || '';
    const windowEnd = now;

    let url: string;
    if (isInitial && !skipToken) {
      // Step 1: Initial download — per docs: no filter, just _skiptoken pagination
      // But we add MlsStatus Eq 'Active' for IDX compliance (ARMLS Rule 23.3.5)
      url = `${SPARK_REPL}/listings?_limit=${SPARK_LIMIT}&_skiptoken=` +
        `&_filter=${encodeURIComponent("MlsStatus Eq 'Active' And PropertyType Eq 'A'")}` +
        `&_expand=Photos,VirtualTours,OpenHouses&_select=${SELECT}`;
    } else if (isInitial && skipToken) {
      // Continuing initial download from saved cursor
      url = `${SPARK_REPL}/listings?_limit=${SPARK_LIMIT}&_skiptoken=${skipToken}` +
        `&_filter=${encodeURIComponent("MlsStatus Eq 'Active' And PropertyType Eq 'A'")}` +
        `&_expand=Photos,VirtualTours,OpenHouses&_select=${SELECT}`;
    } else {
      // Step 2: Incremental — use bt (between) per Spark docs
      const filter = `MlsStatus Eq 'Active' And PropertyType Eq 'A' And ModificationTimestamp bt ${windowStart},${windowEnd}`;
      const st = skipToken ? `&_skiptoken=${skipToken}` : '&_skiptoken=';
      url = `${SPARK_REPL}/listings?_limit=${SPARK_LIMIT}${st}` +
        `&_filter=${encodeURIComponent(filter)}` +
        `&_expand=Photos,VirtualTours,OpenHouses&_select=${SELECT}`;
    }

    console.log(`[Sync] Mode: ${isInitial ? 'INITIAL' : 'INCREMENTAL'} | Resuming: ${!!skipToken} | Window: ${windowStart || 'all'} → ${windowEnd}`);

    let totalSynced = 0;
    let totalSkipped = 0;
    let currentSkipToken = skipToken;
    let page = 0;
    let lastSkipToken = '';

    while (page < MAX_PAGES) {
      let pageUrl = page === 0 ? url :
        url.replace(/(_skiptoken=)[^&]*/, `$1${currentSkipToken}`);

      console.log(`[Sync] Page ${page + 1}...`);

      const res = await fetch(pageUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'HomeFind-AI/2.0 (Supabase Edge Function)',
        },
      });

      if (res.status === 429) {
        console.log('[Sync] Rate limited — saving cursor and stopping');
        await saveCursor({ ...cursor, skiptoken: currentSkipToken, last_run: now, status: 'rate_limited' });
        break;
      }
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Spark ${res.status}: ${err.slice(0, 300)}`);
      }

      const data = await res.json();
      const listings = data?.D?.Results || [];
      if (!listings.length) {
        console.log('[Sync] No more listings — batch complete');
        break;
      }

      // Map & upsert
      const rows = listings.map((l: any) => buildRow(l)).filter(Boolean);
      totalSkipped += (listings.length - rows.length);

      for (let i = 0; i < rows.length; i += DB_BATCH) {
        const batch = rows.slice(i, i + DB_BATCH);
        const { error } = await supabaseAdmin.from('properties').upsert(batch, { onConflict: 'mls_number' });
        if (error) throw new Error(`Upsert error: ${error.message}`);
        totalSynced += batch.length;
      }

      console.log(`[Sync] Page ${page + 1}: ${rows.length} upserted, ${listings.length - rows.length} skipped`);

      // Extract next _skiptoken — Spark Replication API uses the last result's Id as the cursor
      // (NOT @odata.nextLink which is OData v4; Spark has its own format)
      // If we got fewer results than the page size, we've reached the end
      const totalRows = data?.D?.Pagination?.TotalRows ?? 0;
      const lastListing = listings[listings.length - 1];
      const lastId = lastListing?.Id || lastListing?.ListingKey || '';

      if (listings.length < SPARK_LIMIT || !lastId) {
        // Reached the end — no more pages
        currentSkipToken = '';
      } else {
        lastSkipToken = currentSkipToken;
        currentSkipToken = lastId;
      }

      console.log(`[Sync] Page ${page + 1}: ${rows.length} upserted | total in API: ${totalRows} | next skiptoken: ${currentSkipToken ? currentSkipToken.substring(0, 20) + '...' : '(end)'}`);

      // Save cursor after each page (resume on timeout)
      await saveCursor({
        skiptoken: currentSkipToken,
        mode: isInitial ? 'initial' : 'incremental',
        window_start: windowStart,
        window_end: windowEnd,
        last_run: now,
        synced_this_session: totalSynced,
        status: 'in_progress',
        ...(isInitial ? {} : { last_completed_sync: cursor.last_completed_sync }),
      });

      if (!currentSkipToken) {
        console.log('[Sync] No more pages — sync window complete');
        break;
      }
      page++;
    }

    // ── Determine if this sync window is complete ──
    const syncComplete = !currentSkipToken;

    if (syncComplete) {
      // Mark the sync as complete — update the last_completed_sync timestamp
      await saveCursor({
        skiptoken: '',
        mode: 'idle',
        last_completed_sync: now,
        last_run: now,
        synced_last_run: totalSynced,
        status: 'complete',
      });
      console.log(`[Sync] COMPLETE: ${totalSynced} synced, ${totalSkipped} skipped`);
    } else {
      console.log(`[Sync] PAUSED at page ${page + 1} — will resume on next invocation`);
    }

    // Get total count
    const { count } = await supabaseAdmin
      .from('properties').select('*', { count: 'exact', head: true }).eq('status', 'active');

    return jsonResponse({
      success: true,
      synced: totalSynced,
      skipped: totalSkipped,
      pages: page + 1,
      total_active_listings: count,
      sync_complete: syncComplete,
      sync_type: isInitial ? 'initial' : 'incremental',
      will_resume: !syncComplete,
    });

  } catch (err: any) {
    console.error('[Sync] Error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
