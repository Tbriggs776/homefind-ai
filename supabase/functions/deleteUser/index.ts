import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse, getUser } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    if (!user || user.role !== 'admin') return jsonResponse({ error: 'Admin required' }, 403);

    const { userId } = await req.json();
    if (!userId) throw new Error('userId required');

    // Delete user data
    await supabaseAdmin.from('saved_properties').delete().eq('user_id', userId);
    await supabaseAdmin.from('property_views').delete().eq('user_id', userId);
    await supabaseAdmin.from('chat_messages').delete().eq('user_id', userId);
    await supabaseAdmin.from('search_preferences').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
    await supabaseAdmin.auth.admin.deleteUser(userId);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
