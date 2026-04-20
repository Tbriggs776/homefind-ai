import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PropertyCard from '../components/properties/PropertyCard';
import { PropertyCardSkeletonGrid } from '../components/properties/PropertyCardSkeleton';
import SearchFilters from '../components/properties/SearchFilters';
import PropertyMap from '../components/properties/PropertyMap';
import AIAssistant from '../components/ai/AIAssistant';
import EmptyState from '../components/EmptyState';

import NearbyBanner from '../components/properties/NearbyBanner';
import { Button } from '@/components/ui/button';
import { Loader2, Grid3x3, Map, Scale, X, ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

function getDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SESSION_KEY = 'search_state';

// How many properties to fetch for the map view. The map query is "lite" —
// it only fetches the columns needed to render a pin and a popup, so the
// payload per row is roughly 1/5 the size of a full property row. 500 rows
// of lite data is roughly equivalent to 100 rows of full data in bandwidth.
// With clustering enabled in PropertyMap, 500 pins is plenty for the entire
// East Valley plus surrounding metro.
const MAP_QUERY_LIMIT = 500;

function loadSessionState() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveSessionState(state) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {}
}

// Read URL params on initial mount. URL params take precedence over saved
// session state — this is what makes the homepage hero search bar and city
// chips actually filter results when the user clicks them.
function getInitialFilters(savedFilters) {
  if (typeof window === 'undefined') return savedFilters || {};

  const urlParams = new URLSearchParams(window.location.search);
  const cityParam = urlParams.get('city');
  const qParam = urlParams.get('q');
  const subdivisionParam = urlParams.get('subdivision');
  const labelParam = urlParams.get('label'); // optional display label for multi-city, e.g. "East Valley"

  if (cityParam || qParam || subdivisionParam) {
    // Support comma-separated multi-city URLs:
    //   ?city=Queen+Creek           → single city (backward compatible)
    //   ?city=Mesa,Tempe,Chandler   → multi-city array
    //   ?city=Mesa,Tempe&label=East+Valley → multi-city with custom display label
    const cityList = cityParam
      ? cityParam.split(',').map(c => c.trim()).filter(Boolean)
      : [];
    const isMultiCity = cityList.length > 1;

    return {
      ...(savedFilters || {}),
      ...(isMultiCity
        ? { cities: cityList, cities_label: labelParam || cityList.join(', '), city: '' }
        : cityList.length === 1
          ? { city: cityList[0], cities: null, cities_label: '' }
          : {}),
      ...(subdivisionParam ? { subdivision: subdivisionParam } : {}),
      ...(qParam ? { query_text: qParam } : {}),
    };
  }

  return savedFilters || {};
}

// Strip characters that would break PostgREST .or() syntax (commas, parens,
// percent signs, backslashes). Apostrophes and hyphens are safe.
function sanitizeQueryText(text) {
  if (!text) return '';
  return text.replace(/[,()%\\]/g, '').trim();
}

// Apply the current filter set to a Supabase query builder. Used by both
// the grid query and the map query so they stay in sync — when the user
// changes a filter, both queries re-run with the same WHERE clause.
function applyFiltersToQuery(query, filters) {
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  } else {
    query = query.in('status', ['active', 'coming_soon']);
  }

  if (filters.bedrooms) query = query.gte('bedrooms', parseInt(filters.bedrooms));
  if (filters.bathrooms) query = query.gte('bathrooms', parseFloat(filters.bathrooms));
  if (filters.min_price) query = query.gte('price', parseFloat(filters.min_price));
  if (filters.max_price) query = query.lte('price', parseFloat(filters.max_price));
  if (filters.min_sqft) query = query.gte('square_feet', parseInt(filters.min_sqft));
  if (filters.property_types?.length > 0) query = query.in('property_type', filters.property_types);
  if (filters.min_garage_spaces) query = query.gte('garage_spaces', parseInt(filters.min_garage_spaces));
  if (filters.min_lot_size) query = query.gte('lot_size', parseFloat(filters.min_lot_size));
  if (filters.min_year_built) query = query.gte('year_built', parseInt(filters.min_year_built));
  if (filters.max_year_built) query = query.lte('year_built', parseInt(filters.max_year_built));

  const booleanFilters = [
    'private_pool', 'rv_garage', 'single_story', 'horse_property', 'corner_lot',
    'cul_de_sac', 'waterfront', 'golf_course_lot', 'community_pool', 'gated_community',
    'age_restricted_55plus', 'casita_guest_house', 'office_den', 'basement',
    'open_floor_plan', 'recently_remodeled', 'energy_efficient', 'solar_owned', 'solar_leased',
    'spa_hot_tub', 'has_view'
  ];
  booleanFilters.forEach(key => {
    if (filters[key]) query = query.eq(key, true);
  });

  if (filters.has_virtual_tour) query = query.neq('virtual_tour_url', '');
  if (filters.hoa_filter === 'yes') query = query.eq('hoa_required', true);
  if (filters.hoa_filter === 'no') query = query.neq('hoa_required', true);

  // Multi-city filter (from ?city=Mesa,Tempe,Chandler URLs)
  if (filters.cities?.length > 0) {
    const orClauses = filters.cities.map(c => `city.ilike.%${c}%`).join(',');
    query = query.or(orClauses);
  } else if (filters.city) {
    query = query.ilike('city', `%${filters.city}%`);
  }
  if (filters.zip_code) query = query.ilike('zip_code', `%${filters.zip_code}%`);
  if (filters.subdivision) query = query.ilike('subdivision', `%${filters.subdivision}%`);

  // Fuzzy free-text search across address, city, AND subdivision.
  // This is what powers the search input in SearchFilters and the homepage
  // hero search bar. Lets users type "Spur Cross" and find homes in
  // SPUR CROSS PHASE 2 PARCEL 6 even though that's a subdivision name,
  // not a city name. Sanitized to prevent PostgREST syntax injection.
  if (filters.query_text) {
    const q = sanitizeQueryText(filters.query_text);
    if (q.length > 0) {
      query = query.or(
        `address.ilike.%${q}%,city.ilike.%${q}%,subdivision.ilike.%${q}%`
      );
    }
  }

  if (filters.school_name) {
    query = query.or(
      `elementary_school.ilike.%${filters.school_name}%,middle_school.ilike.%${filters.school_name}%,high_school.ilike.%${filters.school_name}%`
    );
  }

  return query;
}

export default function Search() {
  const session = loadSessionState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(() => getInitialFilters(session?.filters));
  const [filtersResetKey, setFiltersResetKey] = useState(0);
  const [savedPropertyIds, setSavedPropertyIds] = useState([]);
  const [viewMode, setViewMode] = useState(session?.viewMode || 'grid');
  const [comparePropertyIds, setComparePropertyIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(session?.currentPage || 1);
  const [totalCount, setTotalCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullStartY, setPullStartY] = useState(0);
  const [sortBy, setSortBy] = useState(session?.sortBy || 'distance');
  const [userLocation, setUserLocation] = useState(() => {
    try {
      const saved = sessionStorage.getItem('user_location');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [locationStatus, setLocationStatus] = useState(() => {
    try {
      return sessionStorage.getItem('user_location') ? 'granted' : sessionStorage.getItem('location_dismissed') ? 'dismissed' : 'prompt';
    } catch { return 'prompt'; }
  });

  const PAGE_SIZE = 50;
  const queryClient = useQueryClient();

  useEffect(() => {
    saveSessionState({ filters, viewMode, currentPage, sortBy });
  }, [filters, viewMode, currentPage, sortBy]);

  const hasActiveFilters = filters.city || filters.cities?.length > 0 || filters.zip_code || filters.subdivision || filters.query_text || filters.bedrooms || filters.bathrooms ||
    filters.min_price || filters.max_price || filters.min_sqft || (filters.property_types?.length > 0) ||
    filters.min_garage_spaces || filters.private_pool || filters.single_story;

  // ============================================================================
  // GRID QUERY — full property data, paginated, 50 per page
  // ============================================================================
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties', filters, currentPage, userLocation?.lat, sortBy],
    queryFn: async () => {
      let query = supabase.from('properties').select('*');
      query = applyFiltersToQuery(query, filters);

      // Sort ordering
      if (sortBy === 'price_low') {
        query = query.order('price', { ascending: true });
      } else if (sortBy === 'price_high') {
        query = query.order('price', { ascending: false });
      } else if (sortBy === 'newest') {
        query = query.order('created_at', { ascending: false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      // Geolocation special case: if user has location, sort=distance, no
      // active filters, and on page 1 — fetch up to 500 and sort by distance
      if (userLocation && sortBy === 'distance' && !hasActiveFilters && currentPage === 1) {
        query = query.limit(500);
        const { data, error } = await query;
        if (error) throw error;

        const withDistance = (data || [])
          .filter(p => p.latitude && p.longitude)
          .map(p => ({ ...p, _distance: getDistanceMiles(userLocation.lat, userLocation.lng, p.latitude, p.longitude) }))
          .sort((a, b) => a._distance - b._distance);
        const noCoords = (data || []).filter(p => !p.latitude || !p.longitude);
        const sorted = [...withDistance, ...noCoords];
        setTotalCount(sorted.length);
        return sorted.slice(0, PAGE_SIZE);
      }

      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error } = await query;
      if (error) throw error;

      if (currentPage === 1) {
        if ((data || []).length < PAGE_SIZE) {
          setTotalCount((data || []).length);
        } else {
          setTotalCount(PAGE_SIZE + 1);
        }
      }

      return data || [];
    },
  });

  // ============================================================================
  // MAP QUERY — lite property data (just enough for pins + popups), up to 500
  // ----------------------------------------------------------------------------
  // Runs in parallel with the grid query on every filter change. Uses a
  // separate cache key so the two don't conflict. Always runs (not gated on
  // viewMode) so the data is cached by the time the user clicks Map view.
  // The lite payload (~13 columns vs select('*')) keeps this fast even at 500
  // rows.
  // ============================================================================
  const { data: mapProperties = [], isLoading: mapLoading } = useQuery({
    queryKey: ['mapProperties', filters],
    queryFn: async () => {
      let query = supabase
        .from('properties')
        .select('id, latitude, longitude, price, address, city, state, zip_code, bedrooms, bathrooms, square_feet, images, cross_street');

      query = applyFiltersToQuery(query, filters);
      query = query.limit(MAP_QUERY_LIMIT);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 30000,  // cache map data for 30s — same filters within 30s reuses result
  });

  // Fetch saved properties
  const { data: savedProperties = [] } = useQuery({
    queryKey: ['savedProperties', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('saved_properties')
        .select('property_id')
        .eq('user_id', user.id);
      return data || [];
    },
    enabled: !!user,
    staleTime: 30000
  });

  useEffect(() => {
    setSavedPropertyIds(savedProperties.map(s => s.property_id));
  }, [savedProperties]);

  const saveMutation = useMutation({
    mutationFn: async (property) => {
      const { data: existing } = await supabase
        .from('saved_properties')
        .select('id')
        .eq('user_id', user.id)
        .eq('property_id', property.id);

      if (existing && existing.length > 0) {
        await supabase.from('saved_properties').delete().eq('id', existing[0].id);
        return { action: 'removed', propertyId: property.id };
      } else {
        await supabase.from('saved_properties').insert({
          user_id: user.id,
          property_id: property.id
        });

        await supabase.from('property_views').insert({
          property_id: property.id,
          user_id: user.id,
          interaction_type: 'favorite'
        });

        return { action: 'added', propertyId: property.id };
      }
    },
    onMutate: async (property) => {
      if (savedPropertyIds.includes(property.id)) {
        setSavedPropertyIds(prev => prev.filter(id => id !== property.id));
      } else {
        setSavedPropertyIds(prev => [...prev, property.id]);
      }
    },
    onError: (error, property) => {
      if (savedPropertyIds.includes(property.id)) {
        setSavedPropertyIds(prev => prev.filter(id => id !== property.id));
      } else {
        setSavedPropertyIds(prev => [...prev, property.id]);
      }
    },
    onSuccess: (result) => {
      if (result.action === 'added') {
        setSavedPropertyIds(prev => [...prev, result.propertyId]);
      } else {
        setSavedPropertyIds(prev => prev.filter(id => id !== result.propertyId));
      }
    }
  });

  const handleFavorite = (property) => {
    if (!user) {
      navigate('/Login');
      return;
    }
    saveMutation.mutate(property);
  };

  const handleCompare = (property) => {
    setComparePropertyIds(prev => {
      if (prev.includes(property.id)) {
        return prev.filter(id => id !== property.id);
      } else {
        if (prev.length >= 4) return prev;
        return [...prev, property.id];
      }
    });
  };

  const handlePullRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['properties'] });
    await queryClient.invalidateQueries({ queryKey: ['mapProperties'] });
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleTouchStart = (e) => {
    if (window.scrollY === 0) setPullStartY(e.touches[0].clientY);
  };
  const handleTouchMove = (e) => {
    if (pullStartY > 0) {
      const pullDistance = e.touches[0].clientY - pullStartY;
      if (pullDistance > 80 && !isRefreshing) {
        handlePullRefresh();
        setPullStartY(0);
      }
    }
  };
  const handleTouchEnd = () => setPullStartY(0);

  const requestLocation = () => {
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setLocationStatus('granted');
        sessionStorage.setItem('user_location', JSON.stringify(loc));
        queryClient.invalidateQueries({ queryKey: ['properties'] });
      },
      () => {
        setLocationStatus('dismissed');
        sessionStorage.setItem('location_dismissed', '1');
      },
      { timeout: 10000 }
    );
  };

  const dismissLocation = () => {
    setLocationStatus('dismissed');
    sessionStorage.setItem('location_dismissed', '1');
  };

  useEffect(() => {
    if (userLocation || locationStatus === 'dismissed') return;
    navigator.permissions?.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'granted') requestLocation();
    }).catch(() => {});
  }, []);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);

    if (user) {
      (async () => {
        const prefsData = {
          user_id: user.id,
          min_price: newFilters.min_price ? parseFloat(newFilters.min_price) : null,
          max_price: newFilters.max_price ? parseFloat(newFilters.max_price) : null,
          min_bedrooms: newFilters.bedrooms ? parseInt(newFilters.bedrooms) : null,
          min_bathrooms: newFilters.bathrooms ? parseInt(newFilters.bathrooms) : null,
          property_types: newFilters.property_types || [],
          zip_code: newFilters.zip_code || null,
          extra_filters: newFilters,
          updated_at: new Date().toISOString()
        };

        const { data: existing } = await supabase
          .from('search_preferences')
          .select('id')
          .eq('user_id', user.id);

        if (existing && existing.length > 0) {
          await supabase.from('search_preferences').update(prefsData).eq('id', existing[0].id);
        } else {
          await supabase.from('search_preferences').insert(prefsData);
        }
      })();
    }
  };

  const sortOptions = [
    { value: 'distance', label: userLocation ? 'Closest to you' : 'Newest first' },
    { value: 'price_low', label: 'Price: Low to High' },
    { value: 'price_high', label: 'Price: High to Low' },
    { value: 'newest', label: 'Newest listings' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {isRefreshing && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-white rounded-full px-4 py-2 shadow-lg">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <div
        className="crandell-container py-8"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="space-y-6">
          {/* Filter chips — full-width row above the results */}
          <SearchFilters key={filtersResetKey} onFilterChange={handleFilterChange} initialFilters={filters} />

          <div>
            <NearbyBanner
              locationStatus={locationStatus}
              onRequestLocation={requestLocation}
              onDismiss={dismissLocation}
            />

            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-normal text-foreground">
                  {viewMode === 'map'
                    ? `${mapProperties.length.toLocaleString()} ${mapProperties.length === 1 ? 'Home' : 'Homes'} on Map`
                    : `${totalCount > PAGE_SIZE ? `${PAGE_SIZE}+` : totalCount} ${totalCount === 1 ? 'Home' : 'Homes'} Available`
                  }
                </h2>
                {(filters.city || filters.cities_label) && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    in {filters.cities_label || filters.city}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="sort-select" className="text-sm text-muted-foreground whitespace-nowrap">
                    Sort:
                  </label>
                  <select
                    id="sort-select"
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
                    className="text-sm border border-border rounded-md px-3 py-1.5 bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {sortOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={viewMode === 'grid' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className={`select-none ${viewMode === 'grid' ? 'bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground' : ''}`}
                  >
                    <Grid3x3 className="h-4 w-4 mr-2" />
                    Grid
                  </Button>
                  <Button
                    variant={viewMode === 'map' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('map')}
                    className={`select-none ${viewMode === 'map' ? 'bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground' : ''}`}
                  >
                    <Map className="h-4 w-4 mr-2" />
                    Map
                  </Button>
                </div>
              </div>
            </div>

            {viewMode === 'map' ? (
              // Map view — uses the dedicated mapProperties query (up to 500 pins)
              mapLoading ? (
                <div className="flex justify-center items-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <PropertyMap
                  properties={properties}
                  mapProperties={mapProperties}
                  onFavorite={handleFavorite}
                  savedPropertyIds={savedPropertyIds}
                />
              )
            ) : isLoading ? (
              <PropertyCardSkeletonGrid count={9} />
            ) : properties.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No homes match these filters"
                description="Try widening your price range, removing a city, or clearing filters to see more listings."
                action={
                  <Button
                    onClick={() => {
                      handleFilterChange({});
                      setFiltersResetKey(k => k + 1);
                    }}
                    className="bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground"
                  >
                    Clear all filters
                  </Button>
                }
              />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {properties.map(property => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      onFavorite={handleFavorite}
                      isFavorited={savedPropertyIds.includes(property.id)}
                      onCompare={handleCompare}
                      isComparing={comparePropertyIds.includes(property.id)}
                      user={user}
                    />
                  ))}
                </div>

                {properties.length >= PAGE_SIZE && (
                  <div className="mt-8 flex items-center justify-center gap-4">
                    <Button
                      variant="outline"
                      onClick={() => { setCurrentPage(prev => Math.max(1, prev - 1)); window.scrollTo(0, 0); }}
                      disabled={currentPage === 1}
                      className="flex items-center gap-2 select-none"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-foreground font-medium">
                      Page {currentPage}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => { setCurrentPage(prev => prev + 1); window.scrollTo(0, 0); }}
                      disabled={properties.length < PAGE_SIZE}
                      className="flex items-center gap-2 select-none"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Compare Bar */}
      {comparePropertyIds.length > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 md:bottom-6"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
        >
          <div className="bg-secondary text-secondary-foreground rounded-full shadow-2xl px-6 py-4 flex items-center gap-4">
            <Scale className="h-5 w-5" />
            <span className="font-medium">
              {comparePropertyIds.length} {comparePropertyIds.length === 1 ? 'property' : 'properties'} selected
            </span>
            <div className="flex items-center gap-2">
              {comparePropertyIds.length >= 2 && (
                <Link to={createPageUrl('PropertyCompare') + `?ids=${comparePropertyIds.join(',')}`}>
                  <Button size="sm" className="bg-white text-secondary hover:bg-gray-100 select-none">
                    Compare Now
                  </Button>
                </Link>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setComparePropertyIds([])}
                className="text-secondary-foreground hover:bg-white/20 select-none"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {comparePropertyIds.length < 2 && (
              <span className="text-secondary-foreground/70 text-sm">Select at least 2 properties</span>
            )}
            {comparePropertyIds.length >= 4 && (
              <span className="text-amber-300 text-sm">Max 4 properties</span>
            )}
          </div>
        </div>
      )}

      {user && (
        <AIAssistant
          user={user}
          contextData={{ filters, propertyCount: properties.length }}
          onApplyFilters={handleFilterChange}
        />
      )}
    </div>
  );
}
