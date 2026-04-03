import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { firstName, lastName, email, phone, source = 'HomeFind AI', tags = [] } = await req.json();
    const fubKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (!fubKey) throw new Error('FOLLOW_UP_BOSS_API_KEY not set');

    const res = await fetch('https://api.followupboss.com/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(fubKey + ':')}` },
      body: JSON.stringify({
        source, type: 'Registration',
        person: { firstName, lastName, emails: [{ value: email }], phones: phone ? [{ value: phone }] : [], tags },
      }),
    });
    const data = await res.json();
    return jsonResponse({ success: true, data });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
