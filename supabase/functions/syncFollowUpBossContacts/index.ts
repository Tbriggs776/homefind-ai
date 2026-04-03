import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const fubKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (!fubKey) throw new Error('FOLLOW_UP_BOSS_API_KEY not set');

    const res = await fetch('https://api.followupboss.com/v1/people?limit=100&sort=created&order=desc', {
      headers: { Authorization: `Basic ${btoa(fubKey + ':')}` },
    });
    const data = await res.json();
    const contacts = data?.people || [];

    await supabaseAdmin.from('fub_sync_history').insert({
      sync_type: 'contacts', status: 'completed',
      records_synced: contacts.length, metadata: { timestamp: new Date().toISOString() },
    });

    return jsonResponse({ success: true, synced: contacts.length });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
