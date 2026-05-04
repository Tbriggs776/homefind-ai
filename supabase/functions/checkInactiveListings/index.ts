import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

// =============================================================================
// checkInactiveListings — daily reconciliation of local DB ↔ Spark active set
// =============================================================================
// Pulls the full set of Active listings from Spark, compares against our local
// DB, and deletes any local row whose listing_key is not in Spark's current
// active set. IDX compliance rule 23.3.5: only Active listings should remain
// in the database.
//
// Prior version of this function had a critical bug: the local-listings query
// hit the project's PostgREST max-rows cap (1000) and silently truncated, so
// only the first 1000 of ~36k listings were ever reconciled. The other 97%
// stayed in the DB even after going Closed/Pending/Withdrawn on the MLS.
//
// This version paginates the local fetch and adds a safety threshold so the
// function refuses to delete anything if Spark returns suspiciously few rows.
// =============================================================================

const SPARK_API_BASE = 'https://replication.sparkapi.com/v1';
const LOCAL_PAGE_SIZE = 1000;
const SPARK_PAGE_SIZE = 1000;
const MAX_SPARK_PAGES = 200;

// If Spark returns fewer active listings than this, something is wrong
// (rate limit, partial response, auth failure mid-stream) — bail rather than
// risk mass-deleting real inventory. AZ MLS active count is ~30k+ on any
// given day; a healthy result will be well above this floor.
const MIN_EXPECTED_SPARK_ACTIVE = 5000;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SAFETY: this function defaults to dry-run because Spark's pagination
  // for the `MlsStatus Eq 'Active'` query has been observed returning wildly
  // different counts on consecutive identical calls (2,066 vs 9,792 vs 7,689
  // vs 25,114 in the same hour). Until that's understood and we have a
  // reliable way to know we got the full active set, deletions must be
  // explicitly opted into. Pass {"confirmDelete": true} to actually delete.
  // {"dryRun": true} also keeps it in dry mode (legacy/explicit form).
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.confirmDelete !== true || body?.dryRun === true;

  try {
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    // ─── Step 1: Get all listing keys from our local DB ───────────────────
    // Paginated to bypass PostgREST's max-rows cap (1000 by default).
    const localKeys = new Set<string>();
    for (let from = 0; ; from += LOCAL_PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from('properties')
        .select('listing_key')
        .range(from, from + LOCAL_PAGE_SIZE - 1);
      if (error) throw new Error(`Local fetch failed at offset ${from}: ${error.message}`);
      if (!data || data.length === 0) break;
      data.forEach((l: any) => { if (l.listing_key) localKeys.add(l.listing_key); });
      if (data.length < LOCAL_PAGE_SIZE) break;
    }
    console.log(`[checkInactiveListings] scanned ${localKeys.size} local listings`);

    // ─── Step 2: Get all ACTIVE listing keys from Spark API ───────────────
    // Spark Replication API does NOT use OData v4 @odata.nextLink. The
    // skiptoken for the next page is the Id of the last result on the
    // current page. Same pattern as syncSparkApiListings.
    //
    // We trust Pagination.TotalRows from Spark over our own page-count
    // heuristic. If we end up with fewer keys than TotalRows, the loop
    // terminated early and we fail closed (refuse to purge).
    const sparkActiveKeys = new Set<string>();
    const pageDiag: Array<{ page: number; results: number; totalRows: number; tookMs: number }> = [];
    let skipToken = '';
    let page = 0;
    let firstPageTotalRows = 0;

    while (page < MAX_SPARK_PAGES) {
      const url = `${SPARK_API_BASE}/listings?_limit=${SPARK_PAGE_SIZE}` +
        `&_filter=${encodeURIComponent("MlsStatus Eq 'Active'")}` +
        `&_select=ListingKey,Id` +
        (skipToken ? `&_skiptoken=${skipToken}` : '');

      const t0 = Date.now();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      const tookMs = Date.now() - t0;
      if (!res.ok) {
        console.error(`[checkInactiveListings] Spark page ${page} HTTP ${res.status} after ${tookMs}ms`);
        break;
      }

      const data = await res.json();
      const results = data?.D?.Results || [];
      const totalRows = data?.D?.Pagination?.TotalRows ?? 0;
      if (page === 0) firstPageTotalRows = totalRows;

      pageDiag.push({ page, results: results.length, totalRows, tookMs });

      if (results.length === 0) break;

      results.forEach((r: any) => {
        const key = r.ListingKey || r.Id;
        if (key) sparkActiveKeys.add(key);
      });

      // End of data: short page = last page
      if (results.length < SPARK_PAGE_SIZE) break;

      // Next skiptoken = last result's Id (Spark's actual cursor format)
      const lastResult = results[results.length - 1];
      skipToken = lastResult?.Id || lastResult?.ListingKey || '';
      if (!skipToken) break;
      page++;
    }
    console.log(`[checkInactiveListings] fetched ${sparkActiveKeys.size} Spark active listings (TotalRows reported: ${firstPageTotalRows}) across ${page + 1} pages`);

    // Truth check: if Spark's reported TotalRows is meaningfully larger than
    // what we captured, our pagination dropped pages. Refuse to purge.
    if (firstPageTotalRows > 0 && sparkActiveKeys.size < firstPageTotalRows * 0.95) {
      const msg = `Pagination incomplete: captured ${sparkActiveKeys.size} of ${firstPageTotalRows} Spark active listings (${Math.round(100 * sparkActiveKeys.size / firstPageTotalRows)}%). Refusing to purge.`;
      console.error(`[checkInactiveListings] ABORT — ${msg}`);
      return jsonResponse({
        success: false,
        local: localKeys.size,
        spark_active: sparkActiveKeys.size,
        spark_total_rows: firstPageTotalRows,
        purged: 0,
        page_diagnostics: pageDiag,
        message: msg,
      }, 500);
    }

    // (Old MIN_EXPECTED_SPARK_ACTIVE absolute floor removed — replaced by the
    // TotalRows-relative check above, which is more accurate. Spark returns
    // its own count of how many active listings actually exist, so we don't
    // need to guess a floor.)

    // ─── Step 3: Find local listings NOT in Spark's active set, delete ───
    const staleKeys = [...localKeys].filter(k => !sparkActiveKeys.has(k));
    let purged = 0;
    if (!dryRun) {
      for (let i = 0; i < staleKeys.length; i += 500) {
        const batch = staleKeys.slice(i, i + 500);
        const { error } = await supabaseAdmin.from('properties').delete().in('listing_key', batch);
        if (error) {
          console.error(`[checkInactiveListings] delete batch ${i / 500} failed:`, error);
        } else {
          purged += batch.length;
        }
      }
      console.log(`[checkInactiveListings] purged ${purged} stale listings`);
    }

    return jsonResponse({
      success: true,
      dry_run: dryRun,
      local: localKeys.size,
      spark_active: sparkActiveKeys.size,
      spark_total_rows: firstPageTotalRows,
      stale_in_local: staleKeys.length,
      purged,
      page_diagnostics: pageDiag,
      message: dryRun
        ? `DRY RUN: would have removed ${staleKeys.length} non-active listings`
        : `Removed ${purged} non-active listings from database`,
    });
  } catch (err: any) {
    console.error('[checkInactiveListings] error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
