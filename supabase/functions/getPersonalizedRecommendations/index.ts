import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders } from '../_shared/supabaseAdmin.ts';

const ANON_KEY_PREFIX = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let userId: string | null = null;

    // Try 1: Get userId from JWT in Authorization header
    const authHeader = req.headers.get('Authorization');
    if (authHeader && !authHeader.includes(ANON_KEY_PREFIX)) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) userId = user.id;
      } catch (_) { /* fall through */ }
    }

    // Try 2: Get userId from request body
    if (!userId) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.userId) userId = body.userId;
      } catch (_) { /* ignore */ }
    }

    // No user — return empty recommendations (graceful fallback)
    if (!userId) {
      return new Response(
        JSON.stringify({ recommendations: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's search preferences (may not exist)
    const { data: prefs } = await supabaseAdmin
      .from('search_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // Get user's saved properties
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
      .order('created_at', { ascending: false })
      .limit(20);
    const viewedIds = viewed?.map((v: any) => v.property_id) || [];

    // Build recommendation query — using CORRECT column names
    let query = supabaseAdmin
      .from('properties')
      .select('*')
      .eq('status', 'active')
      .order('listing_date', { ascending: false })
      .limit(20);

    if (prefs) {
      if (prefs.min_price) query = query.gte('price', prefs.min_price);
      if (prefs.max_price) query = query.lte('price', prefs.max_price);
      if (prefs.min_beds) query = query.gte('bedrooms', prefs.min_beds);
      if (prefs.min_baths) query = query.gte('bathrooms', prefs.min_baths);
      if (prefs.cities?.length) query = query.in('city', prefs.cities);
      if (prefs.property_types?.length) query = query.in('property_type', prefs.property_types);
      if (prefs.pool) query = query.eq('private_pool', true);
    } else if (savedIds.length > 0) {
      // Learn from saved properties
      const { data: savedProps } = await supabaseAdmin
        .from('properties')
        .select('price, bedrooms, city, property_type')
        .in('id', savedIds.slice(0, 10));

      if (savedProps?.length) {
        const validPrices = savedProps.map((p: any) => p.price).filter((p: any) => p > 0);
        if (validPrices.length) {
          const avgPrice = validPrices.reduce((s: number, p: number) => s + p, 0) / validPrices.length;
          query = query.gte('price', avgPrice * 0.7).lte('price', avgPrice * 1.3);
        }

        const cities = [...new Set(savedProps.map((p: any) => p.city).filter(Boolean))];
        if (cities.length) query = query.in('city', cities as string[]);
      }
    }

    // Exclude already saved and recently viewed
    const excludeIds = [...new Set([...savedIds, ...viewedIds])];
    if (excludeIds.length) {
      query = query.not('id', 'in', `(${excludeIds.map(id => `"${id}"`).join(',')})`);
    }

    const { data: recommendations, error } = await query;
    if (error) throw error;

    return new Response(
      JSON.stringify({ recommendations: recommendations || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('getPersonalizedRecommendations error:', err);
    return new Response(
      JSON.stringify({ error: err.message, recommendations: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
