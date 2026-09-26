import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

/**
 * savedSearchUnsubscribe — turns off alerts for one saved search.
 *
 * Linked from every alert email, so it takes no login: the random per-search
 * unsubscribe_token is the credential. Deploy with verify_jwt off.
 *   GET  ?token=…  → turns alerts off, redirects to the site's confirmation page
 *   POST ?token=…  → RFC 8058 one-click unsubscribe from mail clients; 200
 *
 * (Supabase's default domain won't serve HTML from functions, hence the redirect.)
 */

const SITE = 'https://search.crandellrealestate.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  let status = 'invalid';

  if (UUID_RE.test(token)) {
    const { data, error } = await supabaseAdmin
      .from('saved_searches')
      .update({ alerts_enabled: false })
      .eq('unsubscribe_token', token)
      .select('id');
    if (error) {
      console.error('[savedSearchUnsubscribe] update failed:', error);
      status = 'error';
    } else if (data?.length) {
      status = 'ok';
    }
  }

  if (req.method === 'POST') {
    return new Response(status === 'ok' ? 'unsubscribed' : status, { status: status === 'error' ? 500 : 200 });
  }
  return Response.redirect(`${SITE}/Unsubscribed?status=${status}`, 302);
});
