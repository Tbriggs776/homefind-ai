import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

// =============================================================================
// checkInactiveListings — reconcile the public `properties` table against the
// CURRENT active set from Spark, removing anything no longer active.
// ARMLS IDX Rule 23.3.5: only Active listings may remain in the IDX display.
// =============================================================================
//
// HISTORY / WHY THIS WAS UNRELIABLE
// ---------------------------------
// The old version used the legacy Spark endpoint (replication.sparkapi.com/v1)
// and built the pagination cursor itself from each record's `Id`. That cursor
// is cache-sensitive and truncates at random — identical calls returned 8,732 /
// 18,767 / 5,217 / 38,453 active keys within the same hour. A truncated active
// set makes a diff-and-delete catastrophic (it deletes live listings it merely
// failed to fetch), so the purge oscillated between "deletes real data" and
// "blocked, stale piles up". That's the recurring pain.
//
// THE FIX
// -------
// Use the RESO Web API (replication.sparkapi.com/Reso/OData), which Spark
// documents as the method that "ensures records aren't inadvertently missed":
//   - The server returns @odata.nextLink for the next page; we never build the
//     cursor. End-of-data = no nextLink. Unambiguous.
//   - $count=true returns @odata.count, the authoritative total. We refuse to
//     purge unless we retrieved ~all of it (verified: unique === @odata.count,
//     38,448/38,448, reproducibly).
//
// SAFETY: defaults to dry-run. Pass {"confirmDelete": true} to actually delete.
// =============================================================================

const RESO = 'https://replication.sparkapi.com/Reso/OData/Property';
const LOCAL_PAGE_SIZE = 1000;
const RESO_TOP = 1000;
const HARD_PAGE_CAP = 120; // 120 * 1000 = 120k ceiling; active set is ~38k

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.confirmDelete !== true || body?.dryRun === true;

  try {
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    // ─── Step 1: all listing keys currently in our public table ───────────
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

    // ─── Step 2: authoritative active set via RESO @odata.nextLink ────────
    const sparkActiveKeys = new Set<string>();
    let odataCount: number | null = null;
    let url: string | null =
      `${RESO}?$count=true&$top=${RESO_TOP}&$select=ListingKey&$filter=${encodeURIComponent("StandardStatus eq 'Active'")}`;
    let pages = 0;
    let httpErr = 0;

    while (url && pages < HARD_PAGE_CAP) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      if (!res.ok) {
        httpErr = res.status;
        console.error(`[checkInactiveListings] RESO page ${pages} HTTP ${res.status}`);
        break;
      }
      const data = await res.json();
      if (odataCount === null && typeof data['@odata.count'] === 'number') odataCount = data['@odata.count'];
      for (const r of (data.value || [])) { if (r.ListingKey) sparkActiveKeys.add(r.ListingKey); }
      url = data['@odata.nextLink'] || null; // server-built cursor; absence = EOF
      pages++;
    }
    console.log(`[checkInactiveListings] RESO active: ${sparkActiveKeys.size}/${odataCount} across ${pages} pages (httpErr=${httpErr})`);

    // ─── Completeness gate ────────────────────────────────────────────────
    // unique vs @odata.count is the ground-truth completeness signal. If we
    // didn't get ~all of it, do NOT purge.
    const total = odataCount ?? 0;
    const completeness = total > 0 ? sparkActiveKeys.size / total : 0;
    const wouldPurge = [...localKeys].filter(k => !sparkActiveKeys.has(k)).length;

    const safetyChecks = [
      {
        name: 'odata_count_available',
        ok: total >= 5000,
        detail: `@odata.count = ${total} (must be >=5000; a tiny/zero count means the RESO count request failed — refuse to purge blind)`,
      },
      {
        name: 'crawl_complete',
        ok: completeness >= 0.99 && httpErr === 0,
        detail: `retrieved ${sparkActiveKeys.size}/${total} (${(completeness * 100).toFixed(1)}%) active keys, httpErr=${httpErr} — must be >=99% with no HTTP error`,
      },
      {
        name: 'reasonable_purge_size',
        ok: localKeys.size === 0 || (wouldPurge / localKeys.size) < 0.80,
        detail: `would purge ${wouldPurge} of ${localKeys.size} local rows — must be <80%`,
      },
    ];

    const failed = safetyChecks.filter(c => !c.ok);
    if (failed.length > 0) {
      const msg = `Refusing to purge — ${failed.length} check(s) failed: ${failed.map(c => c.name).join(', ')}`;
      console.error(`[checkInactiveListings] ABORT — ${msg}`);
      return jsonResponse({
        success: false, dry_run: dryRun, local: localKeys.size, spark_active: sparkActiveKeys.size,
        odata_count: total, pages, would_purge: wouldPurge, purged: 0, safety_checks: safetyChecks, message: msg,
      }, 200);
    }

    // ─── Step 3: delete local rows not in the active set ──────────────────
    const staleKeys = [...localKeys].filter(k => !sparkActiveKeys.has(k));
    let purged = 0;
    if (!dryRun) {
      for (let i = 0; i < staleKeys.length; i += 500) {
        const batch = staleKeys.slice(i, i + 500);
        const { error } = await supabaseAdmin.from('properties').delete().in('listing_key', batch);
        if (error) console.error(`[checkInactiveListings] delete batch ${i / 500} failed:`, error);
        else purged += batch.length;
      }
      console.log(`[checkInactiveListings] purged ${purged} stale listings`);
    }

    return jsonResponse({
      success: true,
      dry_run: dryRun,
      local: localKeys.size,
      spark_active: sparkActiveKeys.size,
      odata_count: total,
      stale_in_local: staleKeys.length,
      purged,
      pages,
      safety_checks: safetyChecks.map(c => ({ name: c.name, ok: c.ok })),
      message: dryRun
        ? `DRY RUN: would remove ${staleKeys.length} non-active listings (leaving ${localKeys.size - staleKeys.length})`
        : `Removed ${purged} non-active listings`,
    });
  } catch (err: any) {
    console.error('[checkInactiveListings] error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
