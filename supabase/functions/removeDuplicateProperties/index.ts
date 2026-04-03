import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data: dupes } = await supabaseAdmin.rpc('find_duplicate_listings');
    if (!dupes?.length) return jsonResponse({ removed: 0 });

    let removed = 0;
    for (const d of dupes) {
      const { error } = await supabaseAdmin.from('properties').delete().eq('id', d.duplicate_id);
      if (!error) removed++;
    }
    return jsonResponse({ removed });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
