import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse, getUser } from '../_shared/supabaseAdmin.ts';
import { processEvent, type FubEventRow } from '../_shared/fub.ts';

/**
 * contactAgentForProperty
 *
 * "Schedule a Tour" / "Ask a Question" on a listing. Records the request in
 * the Follow Up Boss outbox (public.fub_events) and sends it right away as a
 * FUB "Property Inquiry" event. If FUB is down or rejects the call with a
 * retryable error, the row stays pending and the process-fub-events cron
 * retries it — the lead is never dropped on the floor.
 *
 * Body: { property: { id } | propertyId, intent: 'tour' | 'question', message?,
 *         source?: 'ai_chat', contact?: { name, email, phone } }
 * Signed-in callers are identified from the JWT only. Signed-out visitors (the
 * AI chat's tour card) must supply contact details and are limited per IP.
 */

const MAX_MESSAGE_LENGTH = 2000;
const ANON_LEADS_PER_IP_PER_DAY = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function hashIp(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`crandell-lead:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanContact(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = str(c.name, 100);
  const email = str(c.email, 200).toLowerCase();
  const phone = str(c.phone, 30).replace(/[^\d+()\-.\s]/g, '');
  if (!name || !EMAIL_RE.test(email)) return null;
  return { name, email, ...(phone ? { phone } : {}) };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    const body = await req.json().catch(() => ({}));
    const propertyId = body.propertyId || body.property?.id;
    const intent = body.intent === 'tour' ? 'tour' : 'question';
    const message = typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE_LENGTH) : '';
    const source = body.source === 'ai_chat' ? 'ai_chat' : undefined;

    let person: { name: string; email: string; phone?: string } | null = null;
    if (!user) {
      person = cleanContact(body.contact);
      if (!person) return jsonResponse({ error: 'Please enter your name and a valid email.' }, 400);
      const { data: withinLimit } = await supabaseAdmin.rpc('ai_usage_hit', {
        p_key: `lead:ip:${await hashIp(req)}`,
        p_limit: ANON_LEADS_PER_IP_PER_DAY,
      });
      if (withinLimit === false) {
        return jsonResponse({ error: "We've received several requests from you today. Please call (480) 544-1539." }, 429);
      }
    }

    if (!propertyId) return jsonResponse({ error: 'propertyId required' }, 400);

    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('id, address, city')
      .eq('id', propertyId)
      .maybeSingle();
    if (!property) return jsonResponse({ error: 'Listing not found' }, 404);

    const { data: row, error: insertError } = await supabaseAdmin
      .from('fub_events')
      .insert({
        user_id: user?.id ?? null,
        event_type: 'Property Inquiry',
        property_id: propertyId,
        payload: { intent, message, ...(source ? { source } : {}), ...(person ? { person } : {}) },
      })
      .select('id, user_id, event_type, property_id, payload, attempts')
      .single();

    if (insertError || !row) {
      console.error('[contactAgentForProperty] outbox insert failed:', insertError);
      return jsonResponse({ error: "We couldn't send your request. Please call (480) 544-1539." }, 500);
    }

    const result = await processEvent(row as FubEventRow);

    // Admin dashboard feed.
    const where = `${property.address}, ${property.city}`;
    const { error: alertError } = await supabaseAdmin.from('engagement_alerts').insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? person?.email,
      user_name: user ? (user.full_name || user.email) : `${person?.name} (not signed in)`,
      status: 'new',
      drop_percentage: 0,
      ai_summary: intent === 'tour' ? `Requested a tour of ${where}` : `Asked a question about ${where}`,
      recommended_action: 'Follow up within 24 hours',
    });
    if (alertError) console.error('[contactAgentForProperty] engagement alert insert failed:', alertError);

    // 'retry' still counts as success for the buyer: the request is saved and
    // the cron will deliver it. Only a hard failure is surfaced.
    if (result.status === 'failed') {
      console.error('[contactAgentForProperty] FUB rejected event', row.id, result);
      return jsonResponse({ error: "We couldn't send your request. Please call (480) 544-1539." }, 502);
    }

    return jsonResponse({ success: true, delivered: result.status === 'sent', intent });
  } catch (err) {
    console.error('[contactAgentForProperty] error:', err);
    return jsonResponse({ error: "We couldn't send your request. Please call (480) 544-1539." }, 500);
  }
});
