import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { userId } = await req.json();
    if (!userId) throw new Error('userId required');

    // Get user's search preferences
    const { data: prefs } = await supabaseAdmin
      .from('search_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get user's saved properties to learn preferences
    const { data: saved } = await supabaseAdmin
      .from('saved_properties')
      .select('property_id')
      .eq('user_id', userId);
    const savedIds = saved?.map((s: any) => s.property_id) || [];

    // Get recently viewed properties
    const { data: viewed } = await supabaseAdmin
      .from('property_views')
      .select('property_id')
      .eq('user_id', userId)
      .order('viewed_at', { ascending: false })
      .limit(20);
    const viewedIds = viewed?.map((v: any) => v.property_id) || [];

    // Build recommendation query based on preferences and behavior
    let query = supabaseAdmin
      .from('properties')
      .select('*')
      .eq('mls_status', 'Active')
      .order('listing_date', { ascending: false })
      .limit(20);

    if (prefs) {
      if (prefs.min_price) query = query.gte('list_price', prefs.min_price);
      if (prefs.max_price) query = query.lte('list_price', prefs.max_price);
      if (prefs.min_beds) query = query.gte('beds', prefs.min_beds);
      if (prefs.min_baths) query = query.gte('baths_total', prefs.min_baths);
      if (prefs.cities?.length) query = query.in('city', prefs.cities);
      if (prefs.property_types?.length) query = query.in('property_type', prefs.property_types);
      if (prefs.pool) query = query.eq('pool', true);
    } else if (savedIds.length > 0) {
      // Learn from saved properties — get avg price range and common cities
      const { data: savedProps } = await supabaseAdmin
        .from('properties')
        .select('list_price, beds, city, property_type')
        .in('id', savedIds.slice(0, 10));

      if (savedProps?.length) {
        const avgPrice = savedProps.reduce((s: number, p: any) => s + (p.list_price || 0), 0) / savedProps.length;
        const minPrice = avgPrice * 0.7;
        const maxPrice = avgPrice * 1.3;
        query = query.gte('list_price', minPrice).lte('list_price', maxPrice);

        const cities = [...new Set(savedProps.map((p: any) => p.city).filter(Boolean))];
        if (cities.length) query = query.in('city', cities as string[]);
      }
    }

    // Exclude already saved and recently viewed
    const excludeIds = [...new Set([...savedIds, ...viewedIds])];
    if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: recommendations, error } = await query;
    if (error) throw error;

    return new Response(
      JSON.stringify({ recommendations: recommendations || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
