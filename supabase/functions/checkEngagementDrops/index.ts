import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: inactiveUsers } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, last_active')
      .lt('last_active', sevenDaysAgo)
      .not('role', 'eq', 'admin');

    return jsonResponse({ inactive_users: inactiveUsers?.length || 0, users: inactiveUsers || [] });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
