// ============================================================================
// Listing search — server-side port of applyFiltersToQuery in
// src/pages/Search.jsx. The AI chat's search tool runs the same filters the
// Search page does, so "Apply" in the chat shows exactly the homes it counted.
// Keep the two in sync when adding filters.
//
// Filter values arrive from the model, so every string is stripped of
// PostgREST syntax characters before it reaches .or() / .ilike().
// ============================================================================
import { supabaseAdmin } from './supabaseAdmin.ts';

export const PROPERTY_TYPES = ['single_family', 'condo', 'townhouse', 'multi_family', 'new_construction', 'land'] as const;
export const STATUSES = ['active', 'coming_soon', 'pending', 'all'] as const;
export const BOOLEAN_FILTERS = [
  'private_pool', 'rv_garage', 'single_story', 'horse_property', 'corner_lot',
  'cul_de_sac', 'waterfront', 'golf_course_lot', 'community_pool', 'gated_community',
  'age_restricted_55plus', 'casita_guest_house', 'office_den', 'basement',
  'open_floor_plan', 'recently_remodeled', 'energy_efficient', 'solar_owned', 'solar_leased',
  'spa_hot_tub', 'has_view',
] as const;

export type ListingFilters = {
  status?: string;
  cities?: string[];
  city?: string;
  zip_code?: string;
  subdivision?: string;
  query_text?: string;
  school_name?: string;
  min_price?: number;
  max_price?: number;
  bedrooms?: number;
  bathrooms?: number;
  min_sqft?: number;
  min_lot_size?: number;
  min_garage_spaces?: number;
  min_year_built?: number;
  max_year_built?: number;
  property_types?: string[];
  hoa_filter?: 'yes' | 'no';
  has_virtual_tour?: boolean;
} & Partial<Record<(typeof BOOLEAN_FILTERS)[number], boolean>>;

export function sanitizeText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[,()%\\*:."']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// deno-lint-ignore no-explicit-any
export function applyListingFilters(query: any, f: ListingFilters) {
  if (f.status && f.status !== 'all') query = query.eq('status', f.status);
  else query = query.in('status', ['active', 'coming_soon']);

  if (f.bedrooms) query = query.gte('bedrooms', f.bedrooms);
  if (f.bathrooms) query = query.gte('bathrooms', f.bathrooms);
  if (f.min_price) query = query.gte('price', f.min_price);
  if (f.max_price) query = query.lte('price', f.max_price);
  if (f.min_sqft) query = query.gte('square_feet', f.min_sqft);
  if (f.property_types?.length) query = query.in('property_type', f.property_types);
  if (f.min_garage_spaces) query = query.gte('garage_spaces', f.min_garage_spaces);
  if (f.min_lot_size) query = query.gte('lot_size', f.min_lot_size);
  if (f.min_year_built) query = query.gte('year_built', f.min_year_built);
  if (f.max_year_built) query = query.lte('year_built', f.max_year_built);

  for (const key of BOOLEAN_FILTERS) {
    if (f[key]) query = query.eq(key, true);
  }

  if (f.has_virtual_tour) query = query.neq('virtual_tour_url', '');
  if (f.hoa_filter === 'yes') query = query.eq('hoa_required', true);
  if (f.hoa_filter === 'no') query = query.neq('hoa_required', true);

  const cities = (f.cities ?? []).map(sanitizeText).filter(Boolean);
  if (cities.length > 0) {
    query = query.or(cities.map((c) => `city.ilike.%${c}%`).join(','));
  } else if (sanitizeText(f.city)) {
    query = query.ilike('city', `%${sanitizeText(f.city)}%`);
  }
  if (sanitizeText(f.zip_code)) query = query.ilike('zip_code', `%${sanitizeText(f.zip_code)}%`);
  if (sanitizeText(f.subdivision)) query = query.ilike('subdivision', `%${sanitizeText(f.subdivision)}%`);

  const q = sanitizeText(f.query_text);
  if (q) query = query.or(`address.ilike.%${q}%,city.ilike.%${q}%,subdivision.ilike.%${q}%`);

  const school = sanitizeText(f.school_name);
  if (school) {
    query = query.or(`elementary_school.ilike.%${school}%,middle_school.ilike.%${school}%,high_school.ilike.%${school}%`);
  }
  return query;
}

const CARD_COLUMNS =
  'id, address, city, state, zip_code, price, bedrooms, bathrooms, square_feet, property_type, primary_photo_url, days_on_market, subdivision';

export async function searchListings(filters: ListingFilters, limit = 5) {
  const countQuery = applyListingFilters(
    supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }),
    filters,
  );
  const rowsQuery = applyListingFilters(supabaseAdmin.from('properties').select(CARD_COLUMNS), filters)
    .order('created_at', { ascending: false })
    .limit(limit);

  const [{ count, error: countError }, { data, error }] = await Promise.all([countQuery, rowsQuery]);
  if (countError) throw countError;
  if (error) throw error;
  return { count: count ?? 0, listings: data ?? [] };
}

// Everything a buyer might ask about, for grounded listing Q&A. Excludes the
// listing agent's private remarks and anything not meant for consumers.
const DETAIL_COLUMNS = [
  'id', 'address', 'city', 'state', 'zip_code', 'subdivision', 'county', 'status',
  'price', 'original_list_price', 'bedrooms', 'bathrooms', 'square_feet', 'lot_size',
  'year_built', 'property_type', 'garage_spaces', 'days_on_market', 'description', 'features',
  'hoa_required', 'hoa_fee', 'hoa_fee_frequency', 'tax_annual_amount',
  'elementary_school', 'middle_school', 'high_school', 'view_description', 'virtual_tour_url',
  'mls_number', 'listing_office_name', ...BOOLEAN_FILTERS,
].join(', ');

export async function getListing(id: string) {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Drop empty/false fields to keep the model's context small.
  return Object.fromEntries(
    Object.entries(data as unknown as Record<string, unknown>).filter(([, v]) => v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)),
  );
}
