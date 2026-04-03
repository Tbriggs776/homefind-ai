import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse, getUser } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    if (!user || user.role !== 'admin') return jsonResponse({ error: 'Admin required' }, 403);

    const { email, role = 'user' } = await req.json();
    if (!email) throw new Error('email required');

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
    if (error) throw error;

    if (data?.user?.id && role !== 'user') {
      await supabaseAdmin.from('profiles').update({ role }).eq('id', data.user.id);
    }

    return jsonResponse({ success: true, userId: data?.user?.id });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
