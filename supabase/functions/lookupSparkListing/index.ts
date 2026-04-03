import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { listingKey, mlsId } = await req.json();
    const query = supabaseAdmin.from('properties').select('*');
    if (listingKey) query.eq('listing_key', listingKey);
    else if (mlsId) query.eq('listing_id', mlsId);
    else throw new Error('listingKey or mlsId required');

    const { data, error } = await query.single();
    if (error) throw error;
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
