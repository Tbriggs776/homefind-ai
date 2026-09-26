// ============================================================================
// Follow Up Boss event sender
// ----------------------------------------------------------------------------
// Every FUB write in the app goes through here as a POST /v1/events, which is
// the endpoint FUB runs lead routing, dedupe (by email/phone) and action plans
// on. Rows come from public.fub_events (the outbox); see the
// fub_event_pipeline migration for how they get there.
// ============================================================================
import { supabaseAdmin } from './supabaseAdmin.ts';

const FUB_BASE = 'https://api.followupboss.com/v1';
const SOURCE = 'HomeFind AI';
const SITE_URL = 'https://search.crandellrealestate.com';
const BASE_TAGS = ['HomeFind AI'];

// Backoff for retryable failures (429, 5xx, network). After the last step the
// event is marked failed so a bad key can't loop forever.
const RETRY_DELAYS_MIN = [1, 5, 15, 60, 240];

export interface FubEventRow {
  id: number;
  // null for leads from signed-out visitors (contact in payload.person)
  user_id: string | null;
  event_type: string;
  property_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface SendResult {
  status: 'sent' | 'retry' | 'failed' | 'skipped';
  fubStatus?: number;
  personId?: string | null;
  error?: string;
}

function fubHeaders(apiKey: string) {
  return {
    Authorization: `Basic ${btoa(apiKey + ':')}`,
    'Content-Type': 'application/json',
    'X-System': Deno.env.get('FUB_SYSTEM') ?? 'HomeFind-AI',
    'X-System-Key': Deno.env.get('FUB_SYSTEM_KEY') ?? 'crandell-real-estate',
  };
}

function splitName(fullName: string | null | undefined, email: string) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: email.split('@')[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function propertyBlock(p: Record<string, any>) {
  return {
    street: p.address,
    city: p.city,
    state: p.state,
    code: p.zip_code,
    mlsNumber: p.mls_number,
    price: p.price,
    forRent: false,
    url: `${SITE_URL}/PropertyDetail?id=${p.id}`,
    type: p.property_type ? String(p.property_type).replace(/_/g, ' ') : undefined,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area: p.square_feet,
  };
}

function money(n: unknown) {
  return typeof n === 'number' ? `$${Math.round(n).toLocaleString('en-US')}` : '';
}

// Build the FUB event body for an outbox row. Returns null when there's
// nothing sendable (e.g. the listing was removed before we got to it).
async function buildEvent(row: FubEventRow, profile: Record<string, any>) {
  const { firstName, lastName } = splitName(profile.full_name, profile.email);
  const tags = [...BASE_TAGS];
  const body: Record<string, any> = {
    source: SOURCE,
    system: Deno.env.get('FUB_SYSTEM') ?? 'HomeFind-AI',
    type: row.event_type,
    person: {
      firstName,
      lastName,
      emails: [{ value: profile.email }],
      ...(profile.phone ? { phones: [{ value: profile.phone }] } : {}),
    },
  };

  let property: Record<string, any> | null = null;
  if (row.property_id) {
    const { data } = await supabaseAdmin
      .from('properties')
      .select('id, address, city, state, zip_code, mls_number, price, property_type, bedrooms, bathrooms, square_feet')
      .eq('id', row.property_id)
      .maybeSingle();
    property = data;
    if (property) body.property = propertyBlock(property);
  }
  const where = property ? `${property.address}, ${property.city}` : 'a listing';

  switch (row.event_type) {
    case 'Registration':
      tags.push('Website Signup');
      body.message = `Created an account on ${SITE_URL.replace('https://', '')}`;
      break;

    case 'Property Inquiry': {
      if (!property) return null;
      if (row.payload.source === 'ai_chat') tags.push('AI Chat');
      const intent = row.payload.intent === 'tour' ? 'tour' : 'question';
      const note = typeof row.payload.message === 'string' ? row.payload.message.trim() : '';
      if (intent === 'tour') {
        tags.push('Tour Request');
        body.message = `Requested a showing of ${where} (${money(property.price)}, MLS# ${property.mls_number ?? 'n/a'}).`
          + (note ? `\n\n"${note}"` : '');
      } else {
        tags.push('Question');
        body.message = `Question about ${where} (${money(property.price)}, MLS# ${property.mls_number ?? 'n/a'}):`
          + `\n\n"${note || 'No message provided'}"`;
      }
      break;
    }

    case 'Saved Property':
      if (!property) return null;
      body.message = `Saved ${where} (${money(property.price)}).`;
      break;

    case 'Viewed Property':
      if (!property) return null;
      if (row.payload.hot) {
        tags.push('Hot Lead');
        body.message = `Hot lead: viewed ${where} ${row.payload.visits} times in the last 7 days.`;
      } else {
        body.message = `Viewed ${where} (${money(property.price)}).`;
      }
      break;

    case 'Property Search': {
      // Read the buyer's latest criteria at send time (the trigger debounces).
      const { data: prefs } = await supabaseAdmin
        .from('search_preferences')
        .select('min_price, max_price, min_bedrooms, min_bathrooms, cities, zip_code, property_types')
        .eq('user_id', row.user_id)
        .maybeSingle();
      if (!prefs) return null;
      const cities: string[] = prefs.cities ?? [];
      body.propertySearch = {
        type: 'For Sale',
        city: cities.length === 1 ? cities[0] : undefined,
        state: 'AZ',
        code: prefs.zip_code ?? undefined,
        minPrice: prefs.min_price ?? undefined,
        maxPrice: prefs.max_price ?? undefined,
        minBedrooms: prefs.min_bedrooms ?? undefined,
        minBathrooms: prefs.min_bathrooms ?? undefined,
      };
      const parts = [
        cities.length ? cities.join(', ') : null,
        prefs.min_price || prefs.max_price ? `${money(prefs.min_price) || 'any'}–${money(prefs.max_price) || 'any'}` : null,
        prefs.min_bedrooms ? `${prefs.min_bedrooms}+ bd` : null,
        prefs.min_bathrooms ? `${prefs.min_bathrooms}+ ba` : null,
        prefs.property_types?.length ? prefs.property_types.join('/').replace(/_/g, ' ') : null,
      ].filter(Boolean);
      body.message = `Searching: ${parts.join(' · ') || 'all Arizona homes'}`;
      break;
    }

    case 'Saved Property Search': {
      const f = (row.payload.filters ?? {}) as Record<string, any>;
      const num = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
      const cities: string[] = Array.isArray(f.cities) && f.cities.length ? f.cities : f.city ? [f.city] : [];
      body.propertySearch = {
        type: 'For Sale',
        city: cities.length === 1 ? cities[0] : undefined,
        state: 'AZ',
        code: f.zip_code || undefined,
        minPrice: num(f.min_price),
        maxPrice: num(f.max_price),
        minBedrooms: num(f.bedrooms),
        minBathrooms: num(f.bathrooms),
      };
      tags.push('Saved Search');
      const parts = [
        cities.length ? cities.join(', ') : null,
        f.min_price || f.max_price ? `${money(num(f.min_price)) || 'any'}–${money(num(f.max_price)) || 'any'}` : null,
        f.bedrooms ? `${f.bedrooms}+ bd` : null,
        f.bathrooms ? `${f.bathrooms}+ ba` : null,
      ].filter(Boolean);
      body.message = `Saved a search with listing alerts: "${row.payload.name}"${parts.length ? ` (${parts.join(' · ')})` : ''}`;
      break;
    }

    default:
      return null;
  }

  body.person.tags = tags;
  return body;
}

// Resolve the FUB person id for a profile we just sent an event for, so the
// daily activity summary (which posts notes to fub_contact_id) covers them.
async function lookupPersonId(apiKey: string, email: string): Promise<string | null> {
  try {
    const res = await fetch(`${FUB_BASE}/people?email=${encodeURIComponent(email)}&limit=1&fields=id`, {
      headers: fubHeaders(apiKey),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.people?.[0]?.id;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}

// Send one outbox row to FUB. Pure: returns what happened, doesn't touch the
// row — see processEvent for the bookkeeping.
export async function sendEvent(row: FubEventRow): Promise<SendResult> {
  const apiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
  if (!apiKey) return { status: 'retry', error: 'FOLLOW_UP_BOSS_API_KEY not set' };

  let profile: Record<string, any> | null;
  if (row.user_id) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role, is_user_admin, fub_contact_id')
      .eq('id', row.user_id)
      .maybeSingle();
    profile = data;
    if (profile?.role === 'admin' || profile?.is_user_admin) return { status: 'skipped', error: 'admin account' };
  } else {
    // Signed-out visitor (AI chat tour request): contact comes with the event.
    const person = (row.payload.person ?? {}) as Record<string, string>;
    profile = { id: null, email: person.email, full_name: person.name, phone: person.phone, fub_contact_id: null };
  }

  if (!profile?.email) return { status: 'skipped', error: 'profile or email missing' };

  const body = await buildEvent(row, profile);
  if (!body) return { status: 'skipped', error: 'nothing to send (listing or search criteria gone)' };

  let res: Response;
  try {
    res = await fetch(`${FUB_BASE}/events`, {
      method: 'POST',
      headers: fubHeaders(apiKey),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: 'retry', error: `network: ${(err as Error).message}` };
  }

  // 200 = existing person updated, 201 = person created, 204 = FUB accepted
  // but ignored it (lead flow set to archive). All three are final.
  if (res.ok) {
    let personId: string | null = profile.fub_contact_id ?? null;
    if (!personId && profile.id) {
      personId = await lookupPersonId(apiKey, profile.email);
      if (personId) {
        await supabaseAdmin.from('profiles').update({ fub_contact_id: personId }).eq('id', profile.id);
      }
    }
    return { status: 'sent', fubStatus: res.status, personId };
  }

  const text = (await res.text().catch(() => '')).slice(0, 500);
  const retryable = res.status === 429 || res.status >= 500;
  return { status: retryable ? 'retry' : 'failed', fubStatus: res.status, error: text || res.statusText };
}

// Send one row and record the outcome on it.
export async function processEvent(row: FubEventRow): Promise<SendResult> {
  const result = await sendEvent(row);
  const attempts = row.attempts + 1;
  const update: Record<string, unknown> = {
    attempts,
    locked_at: null,
    fub_status: result.fubStatus ?? null,
    last_error: result.error ?? null,
  };

  if (result.status === 'sent') {
    update.status = 'sent';
    update.sent_at = new Date().toISOString();
    update.fub_person_id = result.personId ?? null;
  } else if (result.status === 'retry' && attempts <= RETRY_DELAYS_MIN.length) {
    update.status = 'pending';
    update.next_attempt_at = new Date(Date.now() + RETRY_DELAYS_MIN[attempts - 1] * 60_000).toISOString();
  } else {
    update.status = result.status === 'skipped' ? 'skipped' : 'failed';
  }

  const { error } = await supabaseAdmin.from('fub_events').update(update).eq('id', row.id);
  if (error) console.error(`[fub] failed to record outcome for event ${row.id}:`, error);
  return result;
}

// Add a note to a FUB contact (no lead routing — used for activity summaries
// such as saved-search alert digests). Returns true on success.
export async function postFubNote(personId: string, subject: string, body: string): Promise<boolean> {
  const apiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
  if (!apiKey) return false;
  try {
    const res = await fetch(`${FUB_BASE}/notes`, {
      method: 'POST',
      headers: fubHeaders(apiKey),
      body: JSON.stringify({ personId: Number(personId) || personId, subject, body }),
    });
    if (!res.ok) console.error('[fub] note failed:', res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (err) {
    console.error('[fub] note failed:', err);
    return false;
  }
}
