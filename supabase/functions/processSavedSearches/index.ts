import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';
import { applyListingFilters, type ListingFilters } from '../_shared/listingSearch.ts';
import { postFubNote } from '../_shared/fub.ts';

/**
 * processSavedSearches — listing alerts for saved searches (hourly cron).
 *
 * For each saved search with alerts on whose frequency is due, finds what
 * changed since its last run:
 *   new             listings first synced since then that match the filters
 *   price_drop      matching listings with a recorded price cut
 *   pending         matching listings that went pending
 *   back_on_market  matching listings that went from pending back to active
 * Each (search, event) is recorded once in saved_search_hits. New hits are
 * emailed to the buyer (Resend) and noted on their Follow Up Boss contact.
 *
 * POST {}                                  → run (service role only; the cron job)
 * POST { dryRun: true, filters, since }    → counts only, no writes, no PII
 */

const SITE = 'https://search.crandellrealestate.com';
const FUNCTIONS_URL = 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1';
const DUE_MS: Record<string, number> = {
  instant: 55 * 60_000,
  daily: 23 * 60 * 60_000,
  weekly: 6.9 * 24 * 60 * 60_000,
};
const MAX_SEARCHES_PER_RUN = 200;
const TIME_BUDGET_MS = 100_000;
const MAX_HITS_PER_REASON = 25;
const EMAIL_LISTING_LIMIT = 12;

type Reason = 'new' | 'price_drop' | 'pending' | 'back_on_market';
type Hit = { property_id: string; reason: Reason; event_key: string };

function isServiceRole(req: Request): boolean {
  // Deployed with verify_jwt on, so the gateway already checked the signature.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role';
  } catch {
    return false;
  }
}

// Saved filters come from the Search page's state (strings, UI-only keys).
// Keep what the query understands, coerce numbers.
const NUMERIC_KEYS = ['min_price', 'max_price', 'bedrooms', 'bathrooms', 'min_sqft', 'min_lot_size',
  'min_garage_spaces', 'min_year_built', 'max_year_built'];
function normalizeFilters(raw: Record<string, unknown>): ListingFilters {
  const f: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === '' || v == null || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (NUMERIC_KEYS.includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) f[k] = n;
    } else {
      f[k] = v;
    }
  }
  return f as ListingFilters;
}

async function detectHits(filters: ListingFilters, since: string): Promise<Hit[]> {
  const hits: Hit[] = [];

  // New to the site since the last run.
  const { data: fresh, error: freshError } = await applyListingFilters(
    supabaseAdmin.from('properties').select('id'), filters,
  ).gt('created_at', since).order('created_at', { ascending: false }).limit(MAX_HITS_PER_REASON);
  if (freshError) throw freshError;
  for (const p of fresh ?? []) hits.push({ property_id: p.id, reason: 'new', event_key: `new:${p.id}` });

  // Price cuts recorded since the last run.
  const { data: cuts, error: cutsError } = await supabaseAdmin
    .from('property_price_history')
    .select('id, property_id, old_price, new_price')
    .gt('changed_at', since)
    .limit(1000);
  if (cutsError) throw cutsError;
  const cutRows = (cuts ?? []).filter((c) => Number(c.new_price) < Number(c.old_price));
  if (cutRows.length) {
    const { data: matching, error } = await applyListingFilters(
      supabaseAdmin.from('properties').select('id'), filters,
    ).in('id', [...new Set(cutRows.map((c) => c.property_id))]).limit(MAX_HITS_PER_REASON);
    if (error) throw error;
    const ok = new Set((matching ?? []).map((p) => p.id));
    for (const c of cutRows) if (ok.has(c.property_id)) hits.push({ property_id: c.property_id, reason: 'price_drop', event_key: `price_drop:${c.id}` });
  }

  // Status changes recorded since the last run. Match on everything but status.
  const { data: changes, error: changesError } = await supabaseAdmin
    .from('property_status_history')
    .select('id, property_id, old_status, new_status')
    .gt('changed_at', since)
    .limit(1000);
  if (changesError) throw changesError;
  const statusRows = (changes ?? []).filter((c) =>
    c.new_status === 'pending' || (c.old_status === 'pending' && ['active', 'coming_soon'].includes(c.new_status)));
  if (statusRows.length) {
    const { data: matching, error } = await applyListingFilters(
      supabaseAdmin.from('properties').select('id'), { ...filters, status: 'all' },
    ).in('id', [...new Set(statusRows.map((c) => c.property_id))]).limit(MAX_HITS_PER_REASON);
    if (error) throw error;
    const ok = new Set((matching ?? []).map((p) => p.id));
    for (const c of statusRows) {
      if (!ok.has(c.property_id)) continue;
      const reason: Reason = c.new_status === 'pending' ? 'pending' : 'back_on_market';
      hits.push({ property_id: c.property_id, reason, event_key: `${reason}:${c.id}` });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: unknown) => (typeof n === 'number' || (typeof n === 'string' && n) ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : '');
const REASON_LABEL: Record<Reason, string> = {
  new: 'New listing',
  price_drop: 'Price reduced',
  pending: 'Now pending',
  back_on_market: 'Back on the market',
};

function thumb(url: string | null) {
  const m = (url ?? '').match(/^https:\/\/cdn\.(?:photos|resize)\.sparkplatform\.com\/([a-z0-9]+)\/(?:\d+x\d+\/true\/)?([^/?#]+)$/i);
  return m ? `https://cdn.resize.sparkplatform.com/${m[1]}/300x225/true/${m[2]}` : url ?? '';
}

// deno-lint-ignore no-explicit-any
function buildEmail(search: any, firstName: string, rows: { hit: Hit; p: any }[], unsubscribeUrl: string) {
  const items = rows.slice(0, EMAIL_LISTING_LIMIT).map(({ hit, p }) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #E5E8EC">
      <a href="${SITE}/PropertyDetail?id=${esc(p.id)}" style="text-decoration:none;color:#0A0A0A">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:132px;vertical-align:top"><img src="${esc(thumb(p.primary_photo_url))}" width="120" height="90" alt="" style="display:block;border-radius:6px;object-fit:cover;background:#F5F7FA"></td>
          <td style="vertical-align:top;font-family:Roboto,Arial,sans-serif">
            <div style="font-size:12px;font-weight:bold;color:${hit.reason === 'price_drop' ? '#DC2626' : '#00AFE5'};text-transform:uppercase;letter-spacing:.05em">${REASON_LABEL[hit.reason]}</div>
            <div style="font-size:18px;font-weight:bold;margin:2px 0">${esc(money(p.price))}${hit.reason === 'price_drop' && p.previous_list_price ? ` <span style="font-size:13px;color:#8A92A0;text-decoration:line-through;font-weight:normal">${esc(money(p.previous_list_price))}</span>` : ''}</div>
            <div style="font-size:14px;color:#5A6270">${esc(p.address)}, ${esc(p.city)}</div>
            <div style="font-size:13px;color:#5A6270">${esc(p.bedrooms)} bd · ${esc(p.bathrooms)} ba${p.square_feet ? ` · ${Number(p.square_feet).toLocaleString('en-US')} sqft` : ''}</div>
          </td>
        </tr></table>
      </a>
    </td></tr>`).join('');
  const more = rows.length > EMAIL_LISTING_LIMIT ? `<p style="font-size:14px">…and ${rows.length - EMAIL_LISTING_LIMIT} more.</p>` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#F5F7FA">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;padding:24px;font-family:Roboto,Arial,sans-serif;color:#0A0A0A">
      <tr><td>
        <div style="font-size:12px;color:#00AFE5;font-weight:bold;letter-spacing:.08em;text-transform:uppercase">Crandell Home Intelligence</div>
        <h1 style="font-size:22px;font-weight:normal;margin:6px 0 4px">Hi ${esc(firstName)}, here's what's new for "${esc(search.name)}"</h1>
        <p style="font-size:14px;color:#5A6270;margin:0 0 8px">${rows.length} update${rows.length === 1 ? '' : 's'} since we last checked.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
        ${more}
        <p style="margin:20px 0"><a href="${SITE}/SavedProperties" style="background:#00AFE5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:2px;font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase">View your saved searches</a></p>
        <p style="font-size:14px;color:#5A6270">Want to see one in person? Reply to this email or call Tanner at (480) 544-1539.</p>
        <hr style="border:none;border-top:1px solid #E5E8EC;margin:20px 0">
        <p style="font-size:11px;color:#8A92A0;line-height:1.5">
          You're getting this because you saved this search on search.crandellrealestate.com (${esc(search.frequency)} alerts).
          <a href="${esc(unsubscribeUrl)}" style="color:#8A92A0">Turn off alerts for this search</a> ·
          <a href="${SITE}/SavedProperties" style="color:#8A92A0">Manage alerts</a><br>
          Crandell Real Estate Team · Balboa Realty · 21227 E Stacey Rd, Queen Creek, AZ 85142<br>
          Listing information from ARMLS, deemed reliable but not guaranteed.
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const subject = rows.length === 1
    ? `${REASON_LABEL[rows[0].hit.reason]}: ${rows[0].p.address}, ${rows[0].p.city}`
    : `${rows.length} updates for "${search.name}"`;
  return { subject, html };
}

async function sendEmail(to: string, subject: string, html: string, unsubscribeUrl: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('ALERTS_FROM_EMAIL') ?? 'Crandell Real Estate <alerts@crandellrealestate.com>',
      reply_to: Deno.env.get('ALERTS_REPLY_TO') ?? 'tanner@crandellrealestate.com',
      to: [to],
      subject,
      html,
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  if (!res.ok) return { sent: false, reason: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { sent: true };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));

  // Dry run: detection only, for a caller-supplied filter set. Same data the
  // public Search page exposes; no saved searches or buyer data involved.
  if (body.dryRun === true) {
    const since = typeof body.since === 'string' ? body.since : new Date(Date.now() - 24 * 3600_000).toISOString();
    const hits = await detectHits(normalizeFilters(body.filters ?? {}), since);
    const counts: Record<string, number> = {};
    for (const h of hits) counts[h.reason] = (counts[h.reason] ?? 0) + 1;
    return jsonResponse({ dryRun: true, since, counts, total: hits.length });
  }

  if (!isServiceRole(req)) return jsonResponse({ error: 'forbidden' }, 403);

  const started = Date.now();
  const { data: searches, error } = await supabaseAdmin
    .from('saved_searches')
    .select('*, profile:profiles!inner(email, full_name, fub_contact_id, role, is_user_admin)')
    .eq('alerts_enabled', true)
    .order('last_run_at', { ascending: true })
    .limit(MAX_SEARCHES_PER_RUN);
  if (error) return jsonResponse({ error: error.message }, 500);

  const summary = { checked: 0, notified: 0, hits: 0, emails: 0, emailSkipped: 0, fubNotes: 0, errors: 0 };

  for (const search of searches ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (Date.now() - new Date(search.last_run_at).getTime() < (DUE_MS[search.frequency] ?? DUE_MS.daily)) continue;
    summary.checked++;
    const runStart = new Date().toISOString();

    try {
      const hits = await detectHits(normalizeFilters(search.filters), search.last_run_at);
      let fresh: { property_id: string; reason: Reason; event_key: string }[] = [];
      if (hits.length) {
        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('saved_search_hits')
          .upsert(hits.map((h) => ({ ...h, saved_search_id: search.id })), { onConflict: 'saved_search_id,event_key', ignoreDuplicates: true })
          .select('property_id, reason, event_key');
        if (insertError) throw insertError;
        fresh = (inserted ?? []) as typeof fresh;
      }

      if (fresh.length) {
        summary.hits += fresh.length;
        const { data: props } = await supabaseAdmin
          .from('properties')
          .select('id, address, city, price, previous_list_price, bedrooms, bathrooms, square_feet, primary_photo_url')
          .in('id', [...new Set(fresh.map((h) => h.property_id))]);
        const byId = new Map((props ?? []).map((p) => [p.id, p]));
        const order: Reason[] = ['price_drop', 'back_on_market', 'new', 'pending'];
        const rows = fresh
          .filter((h) => byId.has(h.property_id))
          .sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason))
          .map((hit) => ({ hit, p: byId.get(hit.property_id) }));

        const profile = search.profile;
        const unsubscribeUrl = `${FUNCTIONS_URL}/savedSearchUnsubscribe?token=${search.unsubscribe_token}`;
        if (rows.length && profile?.email) {
          const firstName = (profile.full_name || '').split(' ')[0] || 'there';
          const { subject, html } = buildEmail(search, firstName, rows, unsubscribeUrl);
          const result = await sendEmail(profile.email, subject, html, unsubscribeUrl);
          if (result.sent) summary.emails++;
          else { summary.emailSkipped++; console.warn(`[processSavedSearches] email skipped for ${search.id}: ${result.reason}`); }
        }

        const isTeam = profile?.role === 'admin' || profile?.is_user_admin;
        if (rows.length && profile?.fub_contact_id && !isTeam) {
          const lines = rows.slice(0, 20).map(({ hit, p }) =>
            `• ${REASON_LABEL[hit.reason]}: ${p.address}, ${p.city} — ${money(p.price)} (${SITE}/PropertyDetail?id=${p.id})`);
          const ok = await postFubNote(
            profile.fub_contact_id,
            `Saved search alert: "${search.name}"`,
            `HomeFind AI sent ${rows.length} update${rows.length === 1 ? '' : 's'} for "${search.name}":\n${lines.join('\n')}`,
          );
          if (ok) summary.fubNotes++;
        }

        await supabaseAdmin
          .from('saved_search_hits')
          .update({ notified_at: new Date().toISOString() })
          .eq('saved_search_id', search.id)
          .in('event_key', fresh.map((h) => h.event_key));
        summary.notified++;
      }

      await supabaseAdmin
        .from('saved_searches')
        .update({ last_run_at: runStart, ...(fresh.length ? { last_sent_at: new Date().toISOString() } : {}) })
        .eq('id', search.id);
    } catch (err) {
      summary.errors++;
      console.error(`[processSavedSearches] search ${search.id} failed:`, err);
    }
  }

  return jsonResponse(summary);
});
