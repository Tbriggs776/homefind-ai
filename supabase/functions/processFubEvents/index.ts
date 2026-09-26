import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';
import { processEvent, type FubEventRow } from '../_shared/fub.ts';

/**
 * processFubEvents
 *
 * Drains public.fub_events (the Follow Up Boss outbox) — claims due rows and
 * POSTs each to FUB /v1/events via _shared/fub.ts. Scheduled every minute by
 * the 'process-fub-events' pg_cron job.
 *
 * Service-role only: the gateway verifies the JWT signature (verify_jwt on),
 * and we additionally require the role claim to be service_role so the
 * public anon key can't trigger sends.
 */

const BATCH_SIZE = 50;

function isServiceRole(req: Request): boolean {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isServiceRole(req)) return jsonResponse({ error: 'forbidden' }, 403);

  const { data: rows, error } = await supabaseAdmin.rpc('fub_claim_events', { p_limit: BATCH_SIZE });
  if (error) {
    console.error('[processFubEvents] claim failed:', error);
    return jsonResponse({ error: error.message }, 500);
  }

  const counts: Record<string, number> = { sent: 0, retry: 0, failed: 0, skipped: 0 };
  // Sequential on purpose: FUB rate-limits per API key, and a minute's worth
  // of buyer activity for a single team is small.
  for (const row of (rows ?? []) as FubEventRow[]) {
    try {
      const result = await processEvent(row);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      if (result.status !== 'sent') {
        console.warn(`[processFubEvents] event ${row.id} (${row.event_type}) → ${result.status}: ${result.error ?? ''}`);
      }
    } catch (err) {
      counts.retry += 1;
      console.error(`[processFubEvents] event ${row.id} threw:`, err);
      // Leave it for the stale-lock reclaim in fub_claim_events.
    }
  }

  return jsonResponse({ claimed: rows?.length ?? 0, ...counts });
});
