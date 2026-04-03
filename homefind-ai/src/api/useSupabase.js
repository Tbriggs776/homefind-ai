/**
 * useSupabase.js — Data access layer for HomeFind AI
 * Replaces ALL base44.entities.* and base44.functions.invoke() calls.
 *
 * Server-side: text search, PostGIS geo queries, full-text search, pagination
 */

import { supabase } from '@/api/supabaseClient';

// ═══════════════════════════════════════════════════════════════════════
// PROPERTIES
// ═══════════════════════════════════════════════════════════════════════

export async function fetchProperties({
  filters = {},
  page = 1,
  pageSize = 24,
  sortBy = 'list_date',
  sortAsc = false,
} = {}) {
  let query = supabase
    .from('properties')
    .select('*', { count: 'exact' });

  // Always filter active only (IDX compliance)
  query = query.eq('status', 'active');

  // Price range
  if (filters.minPrice) query = query.gte('price', filters.minPrice);
  if (filters.maxPrice) query = query.lte('price', filters.maxPrice);

  // Beds / baths
  if (filters.minBeds) query = query.gte('bedrooms', filters.minBeds);
  if (filters.minBaths) query = query.gte('bathrooms', filters.minBaths);

  // City (server-side ILIKE)
  if (filters.city) query = query.ilike('city', `%${filters.city}%`);

  // Zip
  if (filters.zip) query = query.eq('zip_code', filters.zip);

  // Property type
  if (filters.propertyType && filters.propertyType !== 'all') {
    query = query.eq('property_type', filters.propertyType);
  }

  // Subdivision
  if (filters.subdivision) query = query.ilike('subdivision', `%${filters.subdivision}%`);

  // Sqft
  if (filters.minSqft) query = query.gte('square_feet', filters.minSqft);
  if (filters.maxSqft) query = query.lte('square_feet', filters.maxSqft);

  // Year built
  if (filters.minYear) query = query.gte('year_built', filters.minYear);

  // Pool
  if (filters.hasPool) query = query.eq('has_pool', true);

  // Garage
  if (filters.minGarage) query = query.gte('garage_spaces', filters.minGarage);

  // Sort
  query = query.order(sortBy, { ascending: sortAsc });

  // Pagination
  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  return {
    properties: data || [],
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
    error,
  };
}

export async function fetchProperty(propertyId) {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .single();
  return { property: data, error };
}

export async function fetchPropertyByMls(mlsNumber) {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('mls_number', mlsNumber)
    .single();
  return { property: data, error };
}

export async function fetchFeaturedListings(agentMlsId = 'pc295') {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('list_agent_mls_id', agentMlsId)
    .eq('status', 'active')
    .order('price', { ascending: false })
    .limit(12);

  const { count: totalActive } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  return {
    properties: data || [],
    totalActive: totalActive || 0,
    error,
  };
}

export async function fetchNearbyProperties(lat, lng, radiusMiles = 25, limit = 24) {
  const { data, error } = await supabase.rpc('nearby_properties', {
    lat,
    lng,
    radius_miles: radiusMiles,
    lim: limit,
  });
  return { properties: data || [], error };
}

export async function searchPropertiesFullText(searchText) {
  const { data, error } = await supabase.rpc('search_properties', {
    search_text: searchText,
  });
  return { properties: data || [], error };
}

// ═══════════════════════════════════════════════════════════════════════
// SAVED PROPERTIES
// ═══════════════════════════════════════════════════════════════════════

export async function fetchSavedPropertyIds(userId) {
  const { data, error } = await supabase
    .from('saved_properties')
    .select('property_id')
    .eq('user_id', userId);
  return { ids: (data || []).map(s => s.property_id), error };
}

export async function fetchSavedProperties(userId) {
  const { data, error } = await supabase
    .from('saved_properties')
    .select(`id, property_id, created_at, properties (*)`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const properties = (data || []).map(sp => sp.properties).filter(Boolean);
  return { properties, error };
}

export async function toggleSaveProperty(userId, propertyId) {
  // Check if already saved
  const { data: existing } = await supabase
    .from('saved_properties')
    .select('id')
    .eq('user_id', userId)
    .eq('property_id', propertyId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('saved_properties')
      .delete()
      .eq('id', existing.id);
    return { saved: false, error };
  } else {
    const { error } = await supabase
      .from('saved_properties')
      .insert({ user_id: userId, property_id: propertyId });
    return { saved: true, error };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SEARCH PREFERENCES
// ═══════════════════════════════════════════════════════════════════════

export async function fetchSearchPreferences(userId) {
  const { data, error } = await supabase
    .from('search_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return { preferences: data, error };
}

export async function upsertSearchPreferences(userId, prefs) {
  const { data, error } = await supabase
    .from('search_preferences')
    .upsert({
      user_id: userId,
      min_price: prefs.minPrice || null,
      max_price: prefs.maxPrice || null,
      min_bedrooms: prefs.minBeds || null,
      min_bathrooms: prefs.minBaths || null,
      property_types: prefs.propertyTypes || [],
      zip_code: prefs.zip || null,
    }, { onConflict: 'user_id' });
  return { data, error };
}

// ═══════════════════════════════════════════════════════════════════════
// CHAT MESSAGES (AI assistant)
// ═══════════════════════════════════════════════════════════════════════

export async function fetchChatHistory(userId, limit = 50) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);
  return { messages: data || [], error };
}

export async function saveChatMessage(userId, role, content) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ user_id: userId, role, content })
    .select()
    .single();
  return { message: data, error };
}

// ═══════════════════════════════════════════════════════════════════════
// ANALYTICS (page views, search events)
// ═══════════════════════════════════════════════════════════════════════

export async function logPageView(propertyId, userId = null) {
  await supabase.from('page_views').insert({
    property_id: propertyId,
    user_id: userId,
    viewed_at: new Date().toISOString(),
  });
}

export async function logSearchEvent(filters, resultCount, userId = null) {
  await supabase.from('search_events').insert({
    user_id: userId,
    filters,
    result_count: resultCount,
    searched_at: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════

export async function fetchDashboardStats() {
  const { count: totalActive } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: totalUsers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  const { count: totalSaved } = await supabase
    .from('saved_properties')
    .select('*', { count: 'exact', head: true });

  const { data: recentViews } = await supabase
    .from('page_views')
    .select('*', { count: 'exact', head: true });

  return {
    totalActive: totalActive || 0,
    totalUsers: totalUsers || 0,
    totalSaved: totalSaved || 0,
    totalViews: recentViews || 0,
  };
}
