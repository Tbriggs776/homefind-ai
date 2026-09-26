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
 * Body: { property: { id } | propertyId, intent: 'tour' | 'question', message? }
 * Caller identity comes from the JWT only.
 */

const MAX_MESSAGE_LENGTH = 2000;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return jsonResponse({ error: 'Please sign in to contact the team.' }, 401);

    const body = await req.json().catch(() => ({}));
    const propertyId = body.propertyId || body.property?.id;
    const intent = body.intent === 'tour' ? 'tour' : 'question';
    const message = typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE_LENGTH) : '';

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
        user_id: user.id,
        event_type: 'Property Inquiry',
        property_id: propertyId,
        payload: { intent, message },
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
      user_id: user.id,
      user_email: user.email,
      user_name: user.full_name || user.email,
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
