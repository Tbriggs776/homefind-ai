import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse, getUser } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Identity comes from the session only — never from the request body.
    const userId = (await getUser(req))?.id ?? null;

    // No user identified — return success silently (this function is fire-and-forget)
    if (!userId) {
      return jsonResponse({ success: true, skipped: 'no user identified' });
    }

    // Update last_active_at
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateError) {
      console.error('Update error:', updateError);
      return jsonResponse({ error: updateError.message }, 500);
    }

    return jsonResponse({ success: true });
  } catch (err: any) {
    console.error('markUserActive error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
