import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * syncSparkInternalListings — Internal analytics sync for HomeFind AI
 *
 * Populates the admin-only `properties_internal` table with Active, Pending,
 * and Closed (last 24 months) listings from the ARMLS Spark Replication API.
 * This is separate from `syncSparkApiListings` (public IDX table) to preserve
 * ARMLS Rule 23.3.5 IDX compliance isolation — the public `properties` table
 * stays active-only, while this table holds the full picture for licensed-agent
 * CMA and market-pulse analytics.
 *
 * ── Three-pass design ──
 *   Pass A (active):  MlsStatus Eq 'Active',  no date filter
 *   Pass B (pending): MlsStatus Eq 'Pending', no date filter
 *   Pass C (closed):  MlsStatus Eq 'Closed' And CloseDate ge <24mo-ago>
 *
 * Each pass has its own _skiptoken cursor saved to sync_cache. The function
 * processes MAX_PAGES pages per invocation (to fit the ~60s Edge Function
 * timeout), saves cursor, and returns. Cron (or a manual loop script) calls
 * the function repeatedly until all three passes are complete.
 *
 * ── Key differences from syncSparkApiListings ──
 *   - No Photos/VirtualTours/OpenHouses expansion (not needed for analytics,
 *     and Photos alone is ~60% of payload size)
 *   - No _select — we need all 816 StandardFields stored in raw_data JSONB
 *     as the source of truth. Nulls are stripped before insert (~40% savings).
 *   - Upsert on spark_listing_key (not mls_number), which is the unique
 *     constraint on properties_internal
 *   - No photo/price gating — we want comps for EVERYTHING that transacted
 *   - Cursor key: 'spark_internal_sync_cursor' (namespaced to avoid collision
 *     with the public sync's 'spark_sync_cursor')
 *
 * ── Trigger/invocation ──
 *   Runs via cron or manual invocation. No admin JWT check — service role.
 *   Optional request body: { full_sync: true } to force restart all passes
 *   from scratch, or { reset_pass: 'closed' } to restart a single pass.
 */

const SPARK_REPL = 'https://replication.sparkapi.com/v1';
const DB_BATCH = 100;
const SPARK_LIMIT = 250;
const MAX_PAGES = 4; // 4 × 250 = 1000 listings per invocation, fits 60s timeout
const CURSOR_KEY = 'spark_internal_sync_cursor';
const TANNER_ID = 'pc295';
const CLOSED_LOOKBACK_MONTHS = 24;

type PassName = 'active' | 'pending' | 'closed';
const PASSES: PassName[] = ['active', 'pending', 'closed'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Recursively strip null / undefined / empty-string values from an object.
// Keeps booleans (including false) and zeros. Saves ~40% JSONB storage.
function stripNulls(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    const arr = obj.map(stripNulls).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    let hasKey = false;
    for (const k of Object.keys(obj)) {
      const v = stripNulls(obj[k]);
      if (v !== undefined && v !== '' && !(typeof v === 'string' && v === '********')) {
        out[k] = v;
        hasKey = true;
      }
    }
    return hasKey ? out : undefined;
  }
  if (typeof obj === 'string' && (obj === '' || obj === '********')) return undefined;
  return obj;
}

// Parse a Spark field as a finite number, else null.
function num(v: any): number | null {
  if (v === null || v === undefined || v === '' || v === '********') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function int(v: any): number | null {
  if (v === null || v === undefined || v === '' || v === '********') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Parse Spark boolean: accepts true/'Yes'/'true'/'Y'/1.
function bool(v: any): boolean | null {
  if (v === null || v === undefined || v === '' || v === '********') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  return null;
}

// Spark returns dates like '2024-12-15' or timestamps like '2024-12-15T10:30:00Z'.
// For DATE columns we want just the YYYY-MM-DD. For TIMESTAMPTZ we keep as-is.
function dateOnly(v: any): string | null {
  if (!v || v === '********') return null;
  const s = String(v);
  // If it's already YYYY-MM-DD or YYYY-MM-DDTHH..., take the first 10 chars
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function tsOrNull(v: any): string | null {
  if (!v || v === '********') return null;
  return String(v);
}

function strOrNull(v: any): string | null {
  if (v === null || v === undefined || v === '' || v === '********') return null;
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a properties_internal row from a single Spark listing
// ─────────────────────────────────────────────────────────────────────────────
function buildInternalRow(listing: any) {
  const d = listing.StandardFields || listing;
  const sparkListingKey = String(listing.Id || d.ListingKey || '').trim();
  if (!sparkListingKey) return null;

  // Strip nulls + redactions from the entire StandardFields object for raw_data
  const rawClean = stripNulls(d) ?? {};

  // Crandell team flag — check both list agent and co-list agent
  const laId = (d.ListAgentMlsId || '').toString().toLowerCase();
  const claId = (d.CoListAgentMlsId || '').toString().toLowerCase();
  const isCrandell = laId === TANNER_ID || claId === TANNER_ID;

  // Name-coalescing for list agent (Spark sometimes has FullName, sometimes First/Last)
  const listAgentName =
    strOrNull(d.ListAgentFullName) ||
    strOrNull(d.ListAgentName) ||
    ([d.ListAgentFirstName, d.ListAgentLastName].filter(Boolean).join(' ') || null);

  const coListAgentName =
    strOrNull(d.CoListAgentFullName) ||
    strOrNull(d.CoListAgentName) ||
    ([d.CoListAgentFirstName, d.CoListAgentLastName].filter(Boolean).join(' ') || null);

  const buyerAgentName =
    strOrNull(d.BuyerAgentFullName) ||
    strOrNull(d.BuyerAgentName) ||
    ([d.BuyerAgentFirstName, d.BuyerAgentLastName].filter(Boolean).join(' ') || null);

  const coBuyerAgentName =
    strOrNull(d.CoBuyerAgentFullName) ||
    strOrNull(d.CoBuyerAgentName) ||
    ([d.CoBuyerAgentFirstName, d.CoBuyerAgentLastName].filter(Boolean).join(' ') || null);

  // Beds — ARMLS uses BedsTotal, not BedroomsTotal
  const bedsTotal = int(d.BedsTotal ?? d.BedroomsTotal);

  // Baths
  const bathsFull = num(d.BathsFull);
  const bathsHalf = num(d.BathsHalf);
  const bathsDecimal =
    num(d.BathsTotalDecimal) ??
    (bathsFull !== null || bathsHalf !== null
      ? (bathsFull ?? 0) + (bathsHalf ?? 0) * 0.5
      : null);
  const bathsInt = int(d.BathroomsTotalInteger ?? d.BathsTotal);

  // Living area — prefer LivingArea, fallback BuildingAreaTotal
  const livingAreaSqft = num(d.LivingArea ?? d.BuildingAreaTotal);
  const buildingAreaTotalSqft = num(d.BuildingAreaTotal);

  // Lot size
  const lotSizeAcres = num(d.LotSizeAcres);
  const lotSizeSqft =
    num(d.LotSizeSquareFeet) ??
    (lotSizeAcres !== null ? Math.round(lotSizeAcres * 43560) : null);

  // Pool — ARMLS uses PoolYN (not PoolPrivateYN)
  const poolYn = bool(d.PoolYN) ?? bool(d.PoolPrivateYN);

  return {
    // Identity
    spark_listing_key: sparkListingKey,
    mls_number: strOrNull(d.ListingId),
    mls_status: strOrNull(d.MlsStatus),
    standard_status: strOrNull(d.StandardStatus),
    property_type: strOrNull(d.PropertyType),
    property_sub_type: strOrNull(d.PropertySubType),

    // Price
    list_price: num(d.ListPrice ?? d.CurrentPrice),
    close_price: num(d.ClosePrice),
    original_list_price: num(d.OriginalListPrice),
    previous_list_price: num(d.PreviousListPrice),
    concessions_amount: num(d.ConcessionsAmount),

    // Timing / lifecycle (DATE columns)
    listing_contract_date: dateOnly(d.ListingContractDate),
    on_market_date: dateOnly(d.OnMarketDate),
    pending_date: dateOnly(d.PendingDate ?? d.PendingTimestamp),
    close_date: dateOnly(d.CloseDate ?? d.ClosedTimestamp),
    cancel_date: dateOnly(d.CancelDate),
    withdraw_date: dateOnly(d.WithdrawDate),

    // Timestamps (TIMESTAMPTZ columns)
    status_change_timestamp: tsOrNull(d.StatusChangeTimestamp),
    modification_timestamp: tsOrNull(d.ModificationTimestamp),
    back_on_market_timestamp: tsOrNull(d.BackOnMarketTimestamp),
    original_on_market_timestamp: tsOrNull(d.OriginalOnMarketTimestamp),
    photos_change_timestamp: tsOrNull(d.PhotosChangeTimestamp),

    // Specs
    beds_total: bedsTotal,
    baths_full: bathsFull,
    baths_half: bathsHalf,
    baths_total_decimal: bathsDecimal,
    baths_total_integer: bathsInt,
    living_area_sqft: livingAreaSqft,
    building_area_total_sqft: buildingAreaTotalSqft,
    lot_size_sqft: lotSizeSqft,
    lot_size_acres: lotSizeAcres,
    year_built: int(d.YearBuilt),
    stories: num(d.Stories ?? d.Levels),
    garage_spaces: num(d.GarageSpaces),
    carport_spaces: num(d.CarportSpaces),

    // Location
    unparsed_address: strOrNull(d.UnparsedAddress),
    street_number: strOrNull(d.StreetNumber),
    street_name: strOrNull(d.StreetName),
    city: strOrNull(d.City ?? d.PostalCity),
    state_or_province: strOrNull(d.StateOrProvince),
    postal_code: strOrNull(d.PostalCode),
    county_or_parish: strOrNull(d.CountyOrParish),
    subdivision_name: strOrNull(d.SubdivisionName),
    latitude: num(d.Latitude),
    longitude: num(d.Longitude),
    elementary_school: strOrNull(d.ElementarySchool),
    middle_school: strOrNull(d.MiddleOrJuniorSchool),
    high_school: strOrNull(d.HighSchool),
    school_district: strOrNull(d.ElementarySchoolDistrict ?? d.HighSchoolDistrict),

    // List side
    list_agent_mls_id: strOrNull(d.ListAgentMlsId),
    list_agent_name: listAgentName,
    list_agent_email: strOrNull(d.ListAgentEmail),
    list_agent_direct_phone: strOrNull(
      d.ListAgentDirectPhone ?? d.ListAgentPreferredPhone ?? d.ListAgentOfficePhone
    ),
    list_office_mls_id: strOrNull(d.ListOfficeMlsId ?? d.ListOfficeKey),
    list_office_name: strOrNull(d.ListOfficeName),
    co_list_agent_mls_id: strOrNull(d.CoListAgentMlsId),
    co_list_agent_name: coListAgentName,

    // Buyer side
    buyer_agent_mls_id: strOrNull(d.BuyerAgentMlsId),
    buyer_agent_name: buyerAgentName,
    buyer_office_mls_id: strOrNull(d.BuyerOfficeMlsId ?? d.BuyerOfficeKey),
    buyer_office_name: strOrNull(d.BuyerOfficeName),
    co_buyer_agent_mls_id: strOrNull(d.CoBuyerAgentMlsId),
    co_buyer_agent_name: coBuyerAgentName,
    buyer_financing: strOrNull(d.BuyerFinancing),

    // Feature flags
    pool_yn: poolYn,
    cooling_yn: bool(d.CoolingYN),
    heating_yn: bool(d.HeatingYN),
    fireplace_yn: bool(d.FireplaceYN),
    basement_yn: bool(d.BasementYN),
    attached_garage_yn: bool(d.AttachedGarageYN),
    new_construction_yn: bool(d.NewConstructionYN),
    comp_sale_yn: bool(d.CompSaleYN),
    horse_yn: bool(d.HorseYN),
    waterfront_yn: bool(d.WaterfrontYN),

    // Crandell flag
    is_crandell_listing: isCrandell,

    // Raw source of truth (all 816 fields, nulls + redactions stripped)
    raw_data: rawClean,

    // Metadata
    synced_at: new Date().toISOString(),
    spark_sync_version: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor state shape
// ─────────────────────────────────────────────────────────────────────────────
interface PassState {
  skiptoken: string;
  last_completed_sync: string | null; // ISO timestamp of last successful full pass
  rows_synced_total: number; // running total across this pass's current cycle
}
interface CursorState {
  current_pass: PassName;
  active: PassState;
  pending: PassState;
  closed: PassState;
  last_run: string | null;
  status: 'idle' | 'in_progress' | 'complete' | 'rate_limited' | 'error';
  last_error?: string;
}

function defaultPassState(): PassState {
  return { skiptoken: '', last_completed_sync: null, rows_synced_total: 0 };
}
function defaultCursor(): CursorState {
  return {
    current_pass: 'active',
    active: defaultPassState(),
    pending: defaultPassState(),
    closed: defaultPassState(),
    last_run: null,
    status: 'idle',
  };
}

async function loadCursor(): Promise<CursorState> {
  const { data, error } = await supabaseAdmin
    .from('sync_cache')
    .select('cache_value')
    .eq('cache_key', CURSOR_KEY)
    .maybeSingle();
  if (error) console.error('[InternalSync] loadCursor error:', error);
  const v = data?.cache_value as Partial<CursorState> | undefined;
  if (!v) return defaultCursor();
  // Merge with defaults to tolerate schema additions
  return {
    ...defaultCursor(),
    ...v,
    active: { ...defaultPassState(), ...(v.active ?? {}) },
    pending: { ...defaultPassState(), ...(v.pending ?? {}) },
    closed: { ...defaultPassState(), ...(v.closed ?? {}) },
  } as CursorState;
}

async function saveCursor(val: CursorState) {
  const { error } = await supabaseAdmin.from('sync_cache').upsert(
    {
      cache_key: CURSOR_KEY,
      cache_value: val,
      sync_key: CURSOR_KEY, // legacy column safety net
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'cache_key' }
  );
  if (error) {
    console.error('[InternalSync] saveCursor FAILED:', error);
    throw new Error(`Failed to save sync cursor: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the Spark URL for a given pass
// ─────────────────────────────────────────────────────────────────────────────
function buildUrl(pass: PassName, skiptoken: string): string {
  // Residential-only filter — PropertyType 'A' = Residential in ARMLS Spark.
  // This matches the public syncSparkApiListings filter and excludes land,
  // commercial, multi-family, and other non-residential types that would
  // pollute Market Pulse metrics (no beds/sqft, different pricing models).
  const RESIDENTIAL = "PropertyType Eq 'A'";

  let filter = '';
  if (pass === 'active') {
    filter = `MlsStatus Eq 'Active' And ${RESIDENTIAL}`;
  } else if (pass === 'pending') {
    filter = `MlsStatus Eq 'Pending' And ${RESIDENTIAL}`;
  } else {
    // closed: last 24 months
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - CLOSED_LOOKBACK_MONTHS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    filter = `MlsStatus Eq 'Closed' And ${RESIDENTIAL} And CloseDate ge ${cutoffDate}`;
  }

  // No _select — we need all StandardFields for raw_data.
  // No _expand — analytics table doesn't need Photos/OpenHouses/VirtualTours.
  const st = skiptoken ? `&_skiptoken=${encodeURIComponent(skiptoken)}` : '&_skiptoken=';
  return `${SPARK_REPL}/listings?_limit=${SPARK_LIMIT}${st}&_filter=${encodeURIComponent(filter)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advance current_pass pointer to the next pass, or finish if all done
// ─────────────────────────────────────────────────────────────────────────────
function nextPass(p: PassName): PassName | null {
  const i = PASSES.indexOf(p);
  if (i < 0 || i >= PASSES.length - 1) return null;
  return PASSES[i + 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!token) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    const body = await req.json().catch(() => ({}));
    const fullSync: boolean = body.full_sync === true;
    const resetPass: PassName | undefined = body.reset_pass;

    let cursor = await loadCursor();

    // Reset handling
    if (fullSync) {
      cursor = defaultCursor();
      console.log('[InternalSync] FULL RESET — starting from active pass');
    } else if (resetPass && PASSES.includes(resetPass)) {
      cursor[resetPass] = defaultPassState();
      cursor.current_pass = resetPass;
      console.log(`[InternalSync] RESET PASS: ${resetPass}`);
    }

    const now = new Date().toISOString();
    const pass = cursor.current_pass;
    const passState = cursor[pass];

    console.log(
      `[InternalSync] Pass: ${pass} | Resume skiptoken: ${
        passState.skiptoken ? passState.skiptoken.substring(0, 20) + '...' : '(start)'
      } | Running total for pass: ${passState.rows_synced_total}`
    );

    let pageSynced = 0;
    let pageSkipped = 0;
    let page = 0;
    let currentSkipToken = passState.skiptoken || '';
    let passCompleted = false;

    while (page < MAX_PAGES) {
      const url = buildUrl(pass, currentSkipToken);
      console.log(`[InternalSync] ${pass} page ${page + 1}...`);

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'HomeFind-AI-Internal/1.0 (Supabase Edge Function)',
        },
      });

      if (res.status === 429) {
        console.log('[InternalSync] Rate limited — saving cursor and stopping');
        cursor.status = 'rate_limited';
        cursor.last_run = now;
        cursor[pass] = { ...passState, skiptoken: currentSkipToken };
        await saveCursor(cursor);
        return jsonResponse({
          success: true,
          pass,
          synced_this_run: pageSynced,
          skipped_this_run: pageSkipped,
          status: 'rate_limited',
          will_resume: true,
        });
      }
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Spark ${res.status}: ${err.slice(0, 300)}`);
      }

      const data = await res.json();
      const listings: any[] = data?.D?.Results || [];
      if (!listings.length) {
        console.log(`[InternalSync] ${pass} — no more listings on page ${page + 1}, pass complete`);
        passCompleted = true;
        currentSkipToken = '';
        break;
      }

      // Map → rows (filter nulls from buildInternalRow)
      const rows = listings
        .map((l) => buildInternalRow(l))
        .filter((r): r is NonNullable<ReturnType<typeof buildInternalRow>> => r !== null);
      pageSkipped += listings.length - rows.length;

      // Upsert in batches of DB_BATCH
      for (let i = 0; i < rows.length; i += DB_BATCH) {
        const batch = rows.slice(i, i + DB_BATCH);
        const { error } = await supabaseAdmin
          .from('properties_internal')
          .upsert(batch, { onConflict: 'spark_listing_key' });
        if (error) throw new Error(`Upsert error: ${error.message}`);
        pageSynced += batch.length;
      }

      // Determine next _skiptoken — Spark uses the last result's Id
      const lastId = listings[listings.length - 1]?.Id || '';
      console.log(
        `[InternalSync] ${pass} page ${page + 1}: ${rows.length} upserted, ${
          listings.length - rows.length
        } skipped | next: ${lastId ? lastId.substring(0, 20) + '...' : '(end)'}`
      );

      if (listings.length < SPARK_LIMIT || !lastId) {
        // Reached end of pass
        passCompleted = true;
        currentSkipToken = '';
        break;
      }
      currentSkipToken = lastId;

      // Save cursor every page so we can resume on crash/timeout
      cursor[pass] = {
        ...passState,
        skiptoken: currentSkipToken,
        rows_synced_total: passState.rows_synced_total + pageSynced,
      };
      cursor.status = 'in_progress';
      cursor.last_run = now;
      await saveCursor(cursor);

      page++;
    }

    // ── End-of-loop: update pass state ──
    const updatedPassTotal = passState.rows_synced_total + pageSynced;

    if (passCompleted) {
      // Mark this pass's last_completed_sync and advance to next pass
      cursor[pass] = {
        skiptoken: '',
        last_completed_sync: now,
        rows_synced_total: 0, // reset for next full cycle of this pass
      };
      const np = nextPass(pass);
      if (np) {
        cursor.current_pass = np;
        cursor.status = 'in_progress';
        console.log(
          `[InternalSync] ${pass} COMPLETE (${updatedPassTotal} rows in cycle). Advancing to ${np}.`
        );
      } else {
        // All three passes done — roll back to active for next cycle
        cursor.current_pass = 'active';
        cursor.status = 'complete';
        console.log(`[InternalSync] ALL PASSES COMPLETE. Resetting pointer to 'active'.`);
      }
    } else {
      // Pass still in progress — cursor was already saved inside the loop,
      // but make sure the final pageSynced is reflected
      cursor[pass] = {
        ...passState,
        skiptoken: currentSkipToken,
        rows_synced_total: updatedPassTotal,
      };
      cursor.status = 'in_progress';
      console.log(`[InternalSync] ${pass} paused after ${page + 1} pages, will resume.`);
    }
    cursor.last_run = now;
    await saveCursor(cursor);

    // Current table count (bounded, head=true so no rows sent back)
    const { count: totalRows } = await supabaseAdmin
      .from('properties_internal')
      .select('*', { count: 'exact', head: true });

    return jsonResponse({
      success: true,
      pass_just_run: pass,
      next_pass: cursor.current_pass,
      pass_completed: passCompleted,
      status: cursor.status,
      synced_this_run: pageSynced,
      skipped_this_run: pageSkipped,
      pages_processed: page + (passCompleted ? 0 : 1),
      pass_cycle_total: updatedPassTotal,
      total_rows_in_table: totalRows ?? null,
      will_resume: cursor.status !== 'complete',
    });
  } catch (err: any) {
    console.error('[InternalSync] Error:', err);
    // Try to persist error state
    try {
      const c = await loadCursor();
      c.status = 'error';
      c.last_error = String(err?.message || err).slice(0, 500);
      c.last_run = new Date().toISOString();
      await saveCursor(c);
    } catch (_) {
      /* ignore secondary save failure */
    }
    return jsonResponse({ error: err.message }, 500);
  }
});
