import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PropertyCard from '../components/properties/PropertyCard';
import SearchFilters from '../components/properties/SearchFilters';
import PropertyMap from '../components/properties/PropertyMap';
import AIAssistant from '../components/ai/AIAssistant';

import NearbyBanner from '../components/properties/NearbyBanner';
import { Button } from '@/components/ui/button';
import { Loader2, Grid3x3, Map, Scale, X, ChevronLeft, ChevronRight } from 'lucide-react';
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
//
//   /Search?q=Queen+Creek      → filters.city = "Queen Creek"
//   /Search?city=Queen+Creek   → filters.city = "Queen Creek"
//
// We default ?q= to filling filters.city because that's the most common case
// for a buyer typing a place name. If they typed an address it won't filter
// precisely but will still narrow to the right city.
function getInitialFilters(savedFilters) {
  if (typeof window === 'undefined') return savedFilters || {};

  const urlParams = new URLSearchParams(window.location.search);
  const cityParam = urlParams.get('city');
  const qParam = urlParams.get('q');

  // Only override saved state if URL has explicit params
  if (cityParam || qParam) {
    return {
      ...(savedFilters || {}),
      city: cityParam || qParam || ''
    };
  }

  return savedFilters || {};
}

export default function Search() {
  const session = loadSessionState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(() => getInitialFilters(session?.filters));
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

  const hasActiveFilters = filters.city || filters.zip_code || filters.bedrooms || filters.bathrooms ||
    filters.min_price || filters.max_price || filters.min_sqft || (filters.property_types?.length > 0) ||
    filters.min_garage_spaces || filters.private_pool || filters.single_story;

  // Fetch properties with Supabase filtering and pagination
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties', filters, currentPage, userLocation?.lat, sortBy],
    queryFn: async () => {
      let query = supabase.from('properties').select('*');

      // Status filter
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      } else {
        query = query.in('status', ['active', 'coming_soon']);
      }

      // Number range filters
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

      // Boolean property filters
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

      // Virtual tour filter
      if (filters.has_virtual_tour) query = query.neq('virtual_tour_url', '');

      // HOA filter
      if (filters.hoa_filter === 'yes') query = query.eq('hoa_required', true);
      if (filters.hoa_filter === 'no') query = query.neq('hoa_required', true);

      // Text-based filters (city, zip, subdivision, school) use ilike for partial matching
      const hasTextFilter = filters.city || filters.zip_code || filters.subdivision || filters.school_name;

      if (hasTextFilter) {
        if (filters.city) query = query.ilike('city', `%${filters.city}%`);
        if (filters.zip_code) query = query.ilike('zip_code', `%${filters.zip_code}%`);
        if (filters.subdivision) query = query.ilike('subdivision', `%${filters.subdivision}%`);

        // School filter needs OR across three columns
        if (filters.school_name) {
          query = query.or(
            `elementary_school.ilike.%${filters.school_name}%,middle_school.ilike.%${filters.school_name}%,high_school.ilike.%${filters.school_name}%`
          );
        }
      }

      // Ordering — sortBy controls the primary sort
      if (sortBy === 'price_low') {
        query = query.order('price', { ascending: true });
      } else if (sortBy === 'price_high') {
        query = query.order('price', { ascending: false });
      } else if (sortBy === 'newest') {
        query = query.order('created_at', { ascending: false });
      } else {
        // 'distance' or default — order by created_at as the DB-level sort,
        // then re-sort by distance in the application layer below
        query = query.order('created_at', { ascending: false });
      }

      // If user has location and sortBy is 'distance' and no specific filters,
      // fetch more and sort by distance in JS
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

      // Paginated query
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      // Approximate count
      if (currentPage === 1) {
        if ((data || []).length < PAGE_SIZE) {
          setTotalCount((data || []).length);
        } else {
          setTotalCount(PAGE_SIZE + 1); // indicates more pages
        }
      }

      return data || [];
    },
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

        // Track engagement
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

    // Save search preferences
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

  // Sort options for the dropdown
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

      {/* Main Content — kitchen hero deleted, page now starts directly with results */}
      <div
        className="crandell-container py-8"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <SearchFilters onFilterChange={handleFilterChange} initialFilters={filters} />
          </div>

          <div className="lg:col-span-3">
            <NearbyBanner
              locationStatus={locationStatus}
              onRequestLocation={requestLocation}
              onDismiss={dismissLocation}
            />

            {/* Results header — count, sort dropdown, view toggle */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-normal text-foreground">
                  {totalCount > PAGE_SIZE ? `${PAGE_SIZE}+` : totalCount} {totalCount === 1 ? 'Home' : 'Homes'} Available
                </h2>
                {filters.city && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    in {filters.city}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Sort dropdown — replaces the static "Sorted by distance from you" text */}
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

                {/* View toggle — Grid / Map */}
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

            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : properties.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-foreground text-lg">No properties match your search criteria.</p>
                <p className="text-muted-foreground mt-2">Try adjusting your filters.</p>
              </div>
            ) : viewMode === 'map' ? (
              <PropertyMap
                properties={properties}
                onFavorite={handleFavorite}
                savedPropertyIds={savedPropertyIds}
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

            {/* RecommendedProperties rail removed — it was showing random unrelated
                listings on a search results page, which confused the filter state.
                Recommendations belong on detail pages as "Similar Homes" scoped to
                the current property, not on a search results page. */}
          </div>
        </div>
      </div>

      {/* Compare Bar — preserved as-is, buyers ask for this feature */}
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

      {/* AI Assistant — preserved with all props including onApplyFilters */}
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
