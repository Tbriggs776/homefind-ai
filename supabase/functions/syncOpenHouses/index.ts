import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * syncOpenHouses — fills properties.open_house_date / _end / _remarks from the
 * Spark RESO OpenHouse resource. syncListingsReso deliberately leaves those
 * columns alone so this job owns them.
 *
 * POST { dryRun: true }  → fetches and reports counts, field names and a few
 *                          sample times. Writes nothing. No auth required
 *                          (returns no listing details beyond MLS keys + times).
 * POST {}                → writes. Service role only (the cron job).
 *
 * For each listing, keeps the earliest upcoming open house. Listings whose
 * open house has passed or was removed from the feed are cleared.
 */

const RESO_OPEN_HOUSE = 'https://replication.sparkapi.com/Reso/OData/OpenHouse';
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const UPDATE_CONCURRENCY = 10;

function isServiceRole(req: Request): boolean {
  // Safe to read the claim without verifying: deployed with verify_jwt on,
  // so the gateway has already checked the signature.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

type OpenHouse = { start: string; end: string | null; remarks: string | null };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  if (!dryRun && !isServiceRole(req)) return jsonResponse({ error: 'forbidden' }, 403);

  const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
  if (!token) return jsonResponse({ error: 'SPARK_OAUTH_ACCESS_TOKEN not set' }, 500);

  // Open houses that haven't ended yet (start within the last 12h covers
  // ones in progress today).
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const filter = `OpenHouseStartTime ge ${since}`;
  let nextUrl: string | null =
    `${RESO_OPEN_HOUSE}?$count=true&$top=${PAGE_SIZE}&$filter=${encodeURIComponent(filter)}&$orderby=OpenHouseStartTime`;

  const byListing = new Map<string, OpenHouse>();
  let fetched = 0;
  let odataCount: number | null = null;
  let fieldNames: string[] = [];
  let pages = 0;

  try {
    while (nextUrl && pages < MAX_PAGES) {
      const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!res.ok) {
        return jsonResponse({ error: `RESO OpenHouse ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
      }
      const data = await res.json();
      pages++;
      if (odataCount === null) odataCount = data['@odata.count'] ?? null;
      const records = (data.value ?? []) as Record<string, unknown>[];
      if (!fieldNames.length && records[0]) fieldNames = Object.keys(records[0]).sort();

      for (const r of records) {
        fetched++;
        const key = r.ListingKey as string | undefined;
        const start = r.OpenHouseStartTime as string | undefined;
        const status = String(r.OpenHouseStatus ?? '').toLowerCase();
        if (!key || !start || status.includes('cancel') || status.includes('ended')) continue;
        const existing = byListing.get(key);
        if (!existing || start < existing.start) {
          byListing.set(key, {
            start,
            end: (r.OpenHouseEndTime as string) ?? null,
            remarks: typeof r.OpenHouseRemarks === 'string' ? r.OpenHouseRemarks.slice(0, 500) : null,
          });
        }
      }
      nextUrl = data['@odata.nextLink'] ?? null;
    }
  } catch (err) {
    console.error('[syncOpenHouses] fetch failed:', err);
    return jsonResponse({ error: 'fetch failed', detail: String(err) }, 502);
  }

  if (dryRun) {
    return jsonResponse({
      dryRun: true,
      odataCount,
      fetched,
      pages,
      complete: !nextUrl,
      listingsWithOpenHouse: byListing.size,
      fieldNames,
      sample: [...byListing.entries()].slice(0, 3).map(([key, oh]) => ({ listingKey: key, start: oh.start, end: oh.end })),
    });
  }

  // ---- write ------------------------------------------------------------
  const entries = [...byListing.entries()];
  let updated = 0;
  for (let i = 0; i < entries.length; i += UPDATE_CONCURRENCY) {
    const results = await Promise.all(entries.slice(i, i + UPDATE_CONCURRENCY).map(([key, oh]) =>
      supabaseAdmin
        .from('properties')
        .update({ open_house_date: oh.start, open_house_end: oh.end, open_house_remarks: oh.remarks })
        .eq('listing_key', key)
        .select('id')
    ));
    for (const r of results) {
      if (r.error) console.error('[syncOpenHouses] update failed:', r.error);
      else updated += r.data?.length ?? 0;
    }
  }

  // Clear open houses that ended or disappeared from the feed. Only when the
  // crawl finished, so a partial fetch never clears valid entries.
  let cleared = 0;
  if (!nextUrl) {
    const { data: current, error } = await supabaseAdmin
      .from('properties')
      .select('listing_key')
      .not('open_house_date', 'is', null);
    if (error) console.error('[syncOpenHouses] stale scan failed:', error);
    const stale = (current ?? []).map((r) => r.listing_key as string).filter((k) => k && !byListing.has(k));
    for (let i = 0; i < stale.length; i += 500) {
      const { error: clearError } = await supabaseAdmin
        .from('properties')
        .update({ open_house_date: null, open_house_end: null, open_house_remarks: null })
        .in('listing_key', stale.slice(i, i + 500));
      if (clearError) console.error('[syncOpenHouses] clear failed:', clearError);
      else cleared += Math.min(500, stale.length - i);
    }
  }

  return jsonResponse({ fetched, listingsWithOpenHouse: byListing.size, updated, cleared, complete: !nextUrl });
});
