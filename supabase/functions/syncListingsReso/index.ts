import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * syncListingsReso — durable Active-listings sync via the RESO Web API.
 *
 * WHY THIS EXISTS
 * ---------------
 * The legacy /v1 _skiptoken sync truncated at random (we built the cursor from
 * each record's Id; Spark's cache made it die anywhere from 8k to 25k of ~38k).
 * The RESO Web API hands us @odata.nextLink — a server-built cursor that, per
 * Spark's own docs, "ensures records aren't inadvertently missed". End-of-data
 * is unambiguous: no nextLink. Completeness is checkable: @odata.count.
 *
 * MODES
 *   { mode: 'full' }        — crawl all Active, upsert. Resumable: saves the
 *                             nextLink after each chunk; call repeatedly (or via
 *                             cron) until { complete: true }. Pass { reset:true }
 *                             to start a fresh full pass.
 *   { mode: 'incremental' } — crawl everything modified in a recent window
 *                             (NO status filter), upsert actives and DELETE any
 *                             that flipped to non-active. This catches
 *                             Active→Closed/Cancelled departures in near-real
 *                             time, so the public table self-heals without a
 *                             full 38k scan.
 *
 * Reuses the same field/feature mapping as syncSparkApiListings; the only
 * adaptation is RESO naming (BedroomsTotal, BathroomsFull/Half) and photos
 * (Media[] instead of Photos[]).
 */

const RESO = 'https://replication.sparkapi.com/Reso/OData/Property';
const RESO_TOP = 100;             // listings per page (Media expand is heavy)
const DB_BATCH = 100;
const TIME_BUDGET_MS = 35_000;    // process pages until this, then save + return
const CURSOR_KEY = 'reso_active_sync_cursor';
const TANNER_ID = 'pc295';

// ─── helpers (ported from syncSparkApiListings) ─────────────────────────────
function sft(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(' ');
  if (typeof val === 'object') return Object.keys(val).join(' ');
  return String(val);
}
function mapType(pt: string | undefined, pst: string | undefined): string {
  const s = (pst || '').toLowerCase();
  if (s.includes('sf') || s.includes('single family')) return 'single_family';
  if (s.includes('cd') || s.includes('condo')) return 'condo';
  if (s.includes('th') || s.includes('townhouse') || s.includes('townhome')) return 'townhouse';
  if (s.includes('mf') || s.includes('multi') || s.includes('duplex') || s.includes('triplex')) return 'multi_family';
  if (s.includes('land') || s.includes('lot') || s.includes('vacant')) return 'land';
  return 'single_family';
}
function mapStatus(ms: string | undefined): string {
  if (!ms) return 'active';
  const s = ms.toLowerCase();
  if (s.includes('active') || s === 'a') return 'active';
  if (s.includes('pending') || s.includes('ucb') || s.includes('under contract') || s.includes('ccbs')) return 'pending';
  if (s.includes('sold') || s.includes('closed')) return 'sold';
  if (s.includes('coming soon')) return 'coming_soon';
  return 'active';
}
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
  const spa = sft(d.SpaFeatures).toLowerCase();
  if (d.SpaYN === true || d.SpaYN === 'Yes' || spa.includes('spa') || spa.includes('hot tub')) f.push('Spa/Hot Tub');
  if (d.ViewYN === true || d.ViewYN === 'Yes' || sft(d.View)) f.push('View');
  return f;
}

// ─── RESO record → the flat shape buildRow expects ──────────────────────────
function resoAdapt(rec: any): any {
  const d: any = { ...rec };
  // bed/bath naming differences
  d.BedsTotal = rec.BedroomsTotal;
  d.BathsFull = rec.BathroomsFull;
  d.BathsHalf = rec.BathroomsHalf;
  d.BathsTotal = rec.BathroomsTotalInteger;
  // photos: Media[] → Photos[]-like, ordered, Photo category only
  const media = Array.isArray(rec.Media) ? rec.Media : [];
  d.Photos = media
    .filter((m: any) => (!m.MediaCategory || m.MediaCategory === 'Photo') && m.MediaURL)
    .sort((a: any, b: any) => (a.Order || 0) - (b.Order || 0))
    .map((m: any) => ({ Uri1024: m.MediaURL, Primary: m.PreferredPhotoYN === true }));
  return d;
}

// ─── Build DB row (ported 1:1 from syncSparkApiListings.buildRow) ───────────
function buildRow(rec: any) {
  const d = resoAdapt(rec);
  const extId = String(d.ListingKey || '');
  const price = parseFloat(d.ListPrice) || 0;
  if (price < 50000) return null;

  const images: string[] = [];
  let primaryUrl: string | null = null;
  for (const p of d.Photos) {
    if (p.Uri1024) images.push(p.Uri1024);
    if (p.Primary && !primaryUrl) primaryUrl = p.Uri1024;
  }
  if (!images.length) return null;
  if (!primaryUrl) primaryUrl = images[0];

  const addr = [d.StreetNumber, d.StreetDirPrefix, d.StreetName, d.StreetSuffix, d.StreetDirSuffix].filter(Boolean).join(' ');
  const unit = d.UnitNumber ? `, Unit ${d.UnitNumber}` : '';
  const address = (addr || d.UnparsedAddress || 'Address Not Available') + unit;

  const all = [d.PublicRemarks, sft(d.CommunityFeatures), sft(d.InteriorFeatures), sft(d.ExteriorFeatures),
    sft(d.ParkingFeatures), sft(d.OtherStructures), sft(d.ArchitecturalStyle), sft(d.PropertyCondition),
    sft(d.PoolFeatures), sft(d.GreenEnergyEfficient), sft(d.GreenEnergyGeneration), sft(d.LotFeatures),
    sft(d.Basement), sft(d.PatioAndPorchFeatures), sft(d.SpaFeatures)].filter(Boolean).join(' ').toLowerCase();

  const lotF = sft(d.LotFeatures).toLowerCase();
  const comF = sft(d.CommunityFeatures).toLowerCase();
  const poolF = sft(d.PoolFeatures).toLowerCase();
  const stories = parseFloat(d.StoriesTotal || d.Stories || d.Levels || '0');
  const assocYN = String(d.AssociationYN || '').toLowerCase();
  const hasHOA = assocYN === 'true' || assocYN === 'yes' || d.AssociationYN === true || (parseFloat(d.AssociationFee) > 0);
  const agentId = (d.ListAgentMlsId || '').toLowerCase();
  const coAgentId = (d.CoListAgentMlsId || '').toLowerCase();
  const vtUrl = d.VirtualTourURLUnbranded || '';
  const baths = (parseFloat(d.BathsFull) || 0) + (parseFloat(d.BathsHalf) || 0) * 0.5;
  const mlsStatus = d.MlsStatus || d.StandardStatus || 'Active';

  return {
    mls_number: String(d.ListingId || extId),
    listing_key: extId,
    external_listing_id: extId,
    listing_source: 'flexmls_idx',
    status: mapStatus(mlsStatus),
    mls_status: mlsStatus,
    last_synced_at: new Date().toISOString(),
    address, city: d.City || d.PostalCity || '', state: d.StateOrProvince || 'AZ',
    zip_code: d.PostalCode || '', county: d.CountyOrParish || '',
    subdivision: d.SubdivisionName || '', cross_street: d.CrossStreet || '',
    latitude: parseFloat(d.Latitude) || null, longitude: parseFloat(d.Longitude) || null,
    price, list_price: price,
    original_list_price: parseFloat(d.OriginalListPrice) || null,
    previous_list_price: parseFloat(d.PreviousListPrice) || null,
    price_change_date: d.PriceChangeTimestamp || null,
    bedrooms: parseInt(d.BedsTotal) || 0,
    bathrooms: baths || parseFloat(d.BathsTotal) || 0,
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
    list_agent_mls_id: d.ListAgentMlsId || '',
    list_office_name: d.ListOfficeName || '',
    listing_office_name: d.ListOfficeName || '',
    listing_office_mls_id: d.ListOfficeKey || d.ListOfficeMlsId || '',
    listing_agent_name: d.ListAgentFullName || [d.ListAgentFirstName, d.ListAgentLastName].filter(Boolean).join(' ') || '',
    listing_agent_email: d.ListAgentEmail || '',
    listing_agent_phone: d.ListAgentDirectPhone || d.ListAgentOfficePhone || d.ListAgentPreferredPhone || '',
    listing_agent_mls_id: d.ListAgentMlsId || '',
    is_featured: agentId === TANNER_ID || coAgentId === TANNER_ID,
    open_house_date: null, open_house_end: null, open_house_remarks: null,
  };
}

async function loadCursor() {
  const { data } = await supabaseAdmin.from('sync_cache').select('cache_value').eq('cache_key', CURSOR_KEY).maybeSingle();
  return data?.cache_value || {};
}
async function saveCursor(val: any) {
  await supabaseAdmin.from('sync_cache').upsert(
    { cache_key: CURSOR_KEY, cache_value: val, sync_key: CURSOR_KEY, updated_at: new Date().toISOString() },
    { onConflict: 'cache_key' },
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const start = Date.now();
  try {
    const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!token) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'incremental' ? 'incremental' : 'full';

    let url: string;
    if (mode === 'incremental') {
      // Window from last completed full/incremental run → now. NO status filter,
      // so departures (Active→Closed/Cancelled/Pending) are included.
      const cur = await loadCursor();
      const since = body.since || cur.last_completed || new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const until = new Date().toISOString();
      const filter = `ModificationTimestamp gt ${since} and ModificationTimestamp lt ${until}`;
      url = `${RESO}?$count=true&$top=${RESO_TOP}&$expand=Media&$filter=${encodeURIComponent(filter)}`;
      const upserts: any[] = [];
      const deletes: string[] = [];
      let odataCount: number | null = null;
      let nextUrl: string | null = url;
      let pages = 0;
      while (nextUrl && (Date.now() - start) < TIME_BUDGET_MS) {
        const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (!res.ok) throw new Error(`RESO ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        if (odataCount === null) odataCount = data['@odata.count'] ?? null;
        for (const rec of (data.value || [])) {
          const isActive = (rec.StandardStatus || rec.MlsStatus || '').toLowerCase().includes('active');
          if (isActive) { const r = buildRow(rec); if (r) upserts.push(r); }
          else if (rec.ListingKey) deletes.push(rec.ListingKey);
        }
        nextUrl = data['@odata.nextLink'] || null;
        pages++;
      }
      for (let i = 0; i < upserts.length; i += DB_BATCH) {
        const { error } = await supabaseAdmin.from('properties').upsert(upserts.slice(i, i + DB_BATCH), { onConflict: 'mls_number' });
        if (error) throw new Error(`Upsert error: ${error.message}`);
      }
      let deleted = 0;
      for (let i = 0; i < deletes.length; i += 500) {
        const { error } = await supabaseAdmin.from('properties').delete().in('listing_key', deletes.slice(i, i + 500));
        if (!error) deleted += Math.min(500, deletes.length - i);
      }
      const complete = !nextUrl;
      if (complete) await saveCursor({ ...(await loadCursor()), last_completed: until });
      return jsonResponse({ success: true, mode, odata_count: odataCount, upserted: upserts.length, deleted, pages, complete });
    }

    // ── full mode ──
    let cur = await loadCursor();
    if (body.reset === true) cur = {};
    url = cur.full_next ||
      `${RESO}?$count=true&$top=${RESO_TOP}&$expand=Media&$filter=${encodeURIComponent("StandardStatus eq 'Active'")}`;

    let nextUrl: string | null = url;
    let pages = 0;
    let synced = 0;
    let skipped = 0;
    let skipLowPrice = 0;
    let skipNoPhoto = 0;
    let odataCount: number | null = null;
    let totalSoFar = cur.full_synced || 0;

    while (nextUrl && (Date.now() - start) < TIME_BUDGET_MS) {
      const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`RESO ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      if (odataCount === null) odataCount = data['@odata.count'] ?? null;
      // skip-reason instrumentation
      for (const rec of (data.value || [])) {
        const price = parseFloat(rec.ListPrice) || 0;
        const media = Array.isArray(rec.Media) ? rec.Media.filter((m: any) => (!m.MediaCategory || m.MediaCategory === 'Photo') && m.MediaURL) : [];
        if (price < 50000) skipLowPrice++;
        else if (media.length === 0) skipNoPhoto++;
      }
      const rows = (data.value || []).map(buildRow).filter(Boolean);
      skipped += (data.value || []).length - rows.length;
      for (let i = 0; i < rows.length; i += DB_BATCH) {
        const { error } = await supabaseAdmin.from('properties').upsert(rows.slice(i, i + DB_BATCH), { onConflict: 'mls_number' });
        if (error) throw new Error(`Upsert error: ${error.message}`);
        synced += rows.slice(i, i + DB_BATCH).length;
      }
      nextUrl = data['@odata.nextLink'] || null;
      pages++;
    }

    totalSoFar += synced;
    const complete = !nextUrl;
    await saveCursor({
      full_next: complete ? '' : nextUrl,
      full_synced: complete ? 0 : totalSoFar,
      last_completed: complete ? new Date().toISOString() : (cur.last_completed || null),
      odata_count: odataCount,
    });

    return jsonResponse({
      success: true, mode, odata_count: odataCount,
      synced_this_run: synced, skipped_this_run: skipped,
      skip_low_price: skipLowPrice, skip_no_photo: skipNoPhoto,
      total_synced: totalSoFar, pages, complete,
    });
  } catch (err: any) {
    console.error('[syncListingsReso] error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
