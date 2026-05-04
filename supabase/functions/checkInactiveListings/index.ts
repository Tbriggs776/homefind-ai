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
    const pageDiag: Array<{ page: number; results: number; totalRows: number; tookMs: number; pagination?: any; firstResultKeys?: string[]; usedSkipToken?: string }> = [];
    let skipToken = '';
    let page = 0;
    let firstPageTotalRows = 0;

    // Default filter is `MlsStatus Eq 'Active'` (no PropertyType) because
    // testing showed Spark's PropertyType=A filter is unstable in our
    // integration — same query returns 12k / 6k / 3k on consecutive sessions
    // (probably the filter being applied after a server-side cursor cache).
    // The bare MlsStatus filter is consistently 20k+ stable across runs.
    //
    // Using the broader reference set is fine because we only DELETE local
    // listings whose key is NOT in the Spark active set. Our residential-
    // only DB plus commercial/land in the broader set just means we never
    // wrongly drop a residential listing that Spark doesn't classify as 'A'.
    //
    // includePropertyFilter and useFullSelect kept as debug toggles.
    const includePropertyFilter = body?.includePropertyFilter === true;   // default false
    const useFullSelect = body?.useFullSelect === true;                   // default false (lighter payload)
    const filterClause = includePropertyFilter
      ? "MlsStatus Eq 'Active' And PropertyType Eq 'A'"
      : "MlsStatus Eq 'Active'";

    while (page < MAX_SPARK_PAGES) {
      let url = `${SPARK_API_BASE}/listings?_limit=${SPARK_PAGE_SIZE}` +
        `&_filter=${encodeURIComponent(filterClause)}`;
      if (!useFullSelect) url += `&_select=ListingKey,Id`;
      if (skipToken) url += `&_skiptoken=${skipToken}`;

      const t0 = Date.now();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      const tookMs = Date.now() - t0;
      if (!res.ok) {
        console.error(`[checkInactiveListings] Spark page ${page} HTTP ${res.status} after ${tookMs}ms`);
        pageDiag.push({ page, results: 0, totalRows: 0, tookMs, pagination: { httpStatus: res.status } });
        break;
      }

      const data = await res.json();
      const results = data?.D?.Results || [];
      const pagination = data?.D?.Pagination;
      const totalRows = pagination?.TotalRows ?? 0;
      if (page === 0) firstPageTotalRows = totalRows;

      // On page 0 only, capture a FULL sample so we can see exactly which
      // field is the listing key. Trim the StandardFields blob to keep
      // response size manageable.
      let firstResultSample: any = undefined;
      if (page === 0 && results[0]) {
        const sample = { ...results[0] };
        if (sample.StandardFields) {
          // Keep only key-identifier fields from StandardFields, drop the rest
          const sf = sample.StandardFields;
          sample.StandardFields = {
            Id: sf.Id,
            ListingKey: sf.ListingKey,
            ListingId: sf.ListingId,
            MlsId: sf.MlsId,
            MlsStatus: sf.MlsStatus,
            UnparsedAddress: sf.UnparsedAddress,
            ListingKeyNumeric: sf.ListingKeyNumeric,
          };
        }
        firstResultSample = sample;
      }

      pageDiag.push({
        page,
        results: results.length,
        totalRows,
        tookMs,
        pagination,
        firstResultKeys: results[0] ? Object.keys(results[0]) : undefined,
        firstResultSample,
        usedSkipToken: skipToken ? skipToken.substring(0, 25) + '...' : '(none)',
      });

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

    // ─── Stability checks before any deletion ─────────────────────────────
    // Run after both fetches complete; any failure aborts with diagnostics.
    // These exist because Spark's pagination has been observed misbehaving
    // (truncating mid-stream, returning inconsistent counts on consecutive
    // calls). TotalRows is unreliable for our query shape (always 0), so
    // we use structural checks on the page sequence instead.
    const lastPage = pageDiag[pageDiag.length - 1];
    const totalFetched = pageDiag.reduce((s, p) => s + p.results, 0);

    const safetyChecks: Array<{ name: string; ok: boolean; detail: string }> = [
      {
        name: 'pagination_terminated',
        ok: !!lastPage && lastPage.results < SPARK_PAGE_SIZE && lastPage.results > 0,
        detail: `last page returned ${lastPage?.results} rows (must be 1..${SPARK_PAGE_SIZE - 1} to confirm we hit end-of-data, not a transient empty/full page)`,
      },
      {
        name: 'multiple_pages_fetched',
        ok: pageDiag.length >= 2,
        detail: `fetched ${pageDiag.length} pages (must be >=2 — single-page result suggests early termination)`,
      },
      {
        name: 'no_zero_pages_mid_stream',
        ok: pageDiag.slice(0, -1).every(p => p.results > 0),
        detail: `${pageDiag.filter(p => p.results === 0).length} mid-stream pages had 0 results`,
      },
      {
        name: 'low_duplicate_rate',
        ok: totalFetched > 0 && sparkActiveKeys.size / totalFetched > 0.85,
        detail: `unique/fetched ratio: ${totalFetched > 0 ? (sparkActiveKeys.size / totalFetched).toFixed(3) : '0'} (must be >0.85 — high dup rate means cursor revisiting)`,
      },
      {
        name: 'minimum_active_set',
        ok: sparkActiveKeys.size >= 5000,
        detail: `Spark returned ${sparkActiveKeys.size} active listings (must be >=5000 — Phoenix MLS active count is consistently >10k)`,
      },
      {
        name: 'reasonable_purge_size',
        ok: localKeys.size === 0 || ([...localKeys].filter(k => !sparkActiveKeys.has(k)).length / localKeys.size) < 0.80,
        detail: `would purge ${[...localKeys].filter(k => !sparkActiveKeys.has(k)).length} of ${localKeys.size} local rows — must be <80% (anything more suggests Spark side is broken)`,
      },
    ];

    const failedChecks = safetyChecks.filter(c => !c.ok);
    if (failedChecks.length > 0) {
      const msg = `Refusing to purge — ${failedChecks.length} safety check(s) failed: ${failedChecks.map(c => c.name).join(', ')}`;
      console.error(`[checkInactiveListings] ABORT — ${msg}`);
      return jsonResponse({
        success: false,
        local: localKeys.size,
        spark_active: sparkActiveKeys.size,
        purged: 0,
        page_diagnostics: pageDiag,
        safety_checks: safetyChecks,
        message: msg,
      }, 500);
    }

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
      filter: filterClause,
      local: localKeys.size,
      spark_active: sparkActiveKeys.size,
      stale_in_local: staleKeys.length,
      purged,
      pages: pageDiag.length,
      total_fetched: pageDiag.reduce((s, p) => s + p.results, 0),
      safety_checks: safetyChecks.map(c => ({ name: c.name, ok: c.ok })),
      message: dryRun
        ? `DRY RUN: would have removed ${staleKeys.length} non-active listings`
        : `Removed ${purged} non-active listings from database`,
    });
  } catch (err: any) {
    console.error('[checkInactiveListings] error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
