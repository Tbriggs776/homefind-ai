import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data: props } = await supabaseAdmin
      .from('properties')
      .select('id, street_number, street_name, city, state, zip_code')
      .is('latitude', null)
      .limit(50);

    let geocoded = 0;
    for (const p of (props || [])) {
      const addr = `${p.street_number} ${p.street_name}, ${p.city}, ${p.state} ${p.zip_code}`;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`, {
          headers: { 'User-Agent': 'HomeFind-AI/1.0' },
        });
        const data = await res.json();
        if (data?.[0]) {
          await supabaseAdmin.from('properties').update({
            latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon),
          }).eq('id', p.id);
          geocoded++;
        }
        await new Promise(r => setTimeout(r, 1100)); // Rate limit: 1 req/sec
      } catch (_) { /* skip */ }
    }
    return jsonResponse({ geocoded, total: props?.length || 0 });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
