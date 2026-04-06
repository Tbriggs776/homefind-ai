import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let userId: string | null = null;

    // Try 1: Get user from JWT in Authorization header (when called with user session)
    const authHeader = req.headers.get('Authorization');
    if (authHeader && !authHeader.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI')) {
      // Has a real JWT, not just the anon key
      const token = authHeader.replace('Bearer ', '');
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) userId = user.id;
      } catch (_) { /* fall through to body check */ }
    }

    // Try 2: Get userId from request body
    if (!userId) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.userId) userId = body.userId;
      } catch (_) { /* ignore */ }
    }

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
