import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { limit = 12 } = await req.json().catch(() => ({}));

    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('status', 'active')
      .eq('is_featured', true)
      .order('price', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Get total active count for display
    const { count: totalActive } = await supabaseAdmin
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // If not enough featured, fill with recent listings
    let properties = data || [];
    if (properties.length < limit) {
      const { data: recent } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('status', 'active')
        .order('listing_date', { ascending: false })
        .limit(limit - properties.length);
      const combined = [...properties, ...(recent || [])];
      properties = [...new Map(combined.map(p => [p.id, p])).values()].slice(0, limit);
    }

    return jsonResponse({ properties, total_active_listings: totalActive || 0 });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
