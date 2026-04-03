import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { limit = 12 } = await req.json().catch(() => ({}));

    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('mls_status', 'Active')
      .eq('is_featured', true)
      .order('list_price', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // If not enough featured, fill with recent listings
    if (!data || data.length < limit) {
      const { data: recent } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('mls_status', 'Active')
        .order('listing_date', { ascending: false })
        .limit(limit - (data?.length || 0));
      const combined = [...(data || []), ...(recent || [])];
      const unique = [...new Map(combined.map(p => [p.id, p])).values()];
      return jsonResponse({ listings: unique.slice(0, limit) });
    }

    return jsonResponse({ listings: data });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
