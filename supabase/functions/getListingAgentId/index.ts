import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { listingKey } = await req.json();
    const { data } = await supabaseAdmin.from('properties').select('listing_agent_id, listing_agent_name').eq('listing_key', listingKey).single();
    return jsonResponse(data || { error: 'Not found' });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
