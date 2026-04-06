import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Get user from JWT in Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'No authorization header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    // Update last_active_at (correct column name)
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', user.id);

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
