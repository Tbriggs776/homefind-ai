import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { listingKeys = [] } = await req.json();
    if (!listingKeys.length) throw new Error('listingKeys array required');

    await supabaseAdmin.from('properties').update({ is_featured: false }).eq('is_featured', true);
    const { error } = await supabaseAdmin.from('properties').update({ is_featured: true }).in('listing_key', listingKeys);
    if (error) throw error;

    return jsonResponse({ success: true, featured: listingKeys.length });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
