import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data } = await supabaseAdmin
      .from('properties')
      .select('id, listing_key, list_price, original_list_price, city')
      .neq('original_list_price', null)
      .eq('mls_status', 'Active')
      .order('modification_timestamp', { ascending: false })
      .limit(50);

    const priceChanges = (data || []).filter(p => p.list_price !== p.original_list_price).map(p => ({
      ...p, change: p.list_price - p.original_list_price,
      change_pct: ((p.list_price - p.original_list_price) / p.original_list_price * 100).toFixed(1),
    }));

    return jsonResponse({ price_changes: priceChanges });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
