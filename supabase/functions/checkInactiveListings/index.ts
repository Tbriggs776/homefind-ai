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
    // current page. Same pattern as syncSparkApiListings (see comments
    // there at line ~365). Loop terminates when a page returns fewer
    // results than the page size.
    const sparkActiveKeys = new Set<string>();
    let skipToken = '';
    let page = 0;

    while (page < MAX_SPARK_PAGES) {
      const url = `${SPARK_API_BASE}/listings?_limit=${SPARK_PAGE_SIZE}` +
        `&_filter=${encodeURIComponent("MlsStatus Eq 'Active'")}` +
        `&_select=ListingKey,Id` +
        (skipToken ? `&_skiptoken=${skipToken}` : '');

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        console.error(`[checkInactiveListings] Spark page ${page} HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      const results = data?.D?.Results || [];
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
    console.log(`[checkInactiveListings] fetched ${sparkActiveKeys.size} Spark active listings across ${page + 1} pages`);

    // ─── Safety: refuse to delete if Spark looks broken ───────────────────
    if (sparkActiveKeys.size < MIN_EXPECTED_SPARK_ACTIVE) {
      const msg = `Spark returned only ${sparkActiveKeys.size} active listings (expected >= ${MIN_EXPECTED_SPARK_ACTIVE}). Refusing to purge — would risk mass-deleting valid inventory. Investigate Spark API health before re-running.`;
      console.error(`[checkInactiveListings] ABORT — ${msg}`);
      return jsonResponse({
        success: false,
        local: localKeys.size,
        spark_active: sparkActiveKeys.size,
        purged: 0,
        message: msg,
      }, 500);
    }

    // ─── Step 3: Find local listings NOT in Spark's active set, delete ───
    const staleKeys = [...localKeys].filter(k => !sparkActiveKeys.has(k));
    let purged = 0;
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
    return jsonResponse({
      success: true,
      local: localKeys.size,
      spark_active: sparkActiveKeys.size,
      purged,
      message: `Removed ${purged} non-active listings from database`,
    });
  } catch (err: any) {
    console.error('[checkInactiveListings] error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
