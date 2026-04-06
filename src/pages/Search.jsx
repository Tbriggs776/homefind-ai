import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PropertyCard from '../components/properties/PropertyCard';
import SearchFilters from '../components/properties/SearchFilters';
import PropertyMap from '../components/properties/PropertyMap';
import RecommendedProperties from '../components/recommendations/RecommendedProperties';
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

export default function Search() {
  const session = loadSessionState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(session?.filters || {});
  const [savedPropertyIds, setSavedPropertyIds] = useState([]);
  const [viewMode, setViewMode] = useState(session?.viewMode || 'grid');
  const [comparePropertyIds, setComparePropertyIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(session?.currentPage || 1);
  const [totalCount, setTotalCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullStartY, setPullStartY] = useState(0);
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
    saveSessionState({ filters, viewMode, currentPage });
  }, [filters, viewMode, currentPage]);

  const hasActiveFilters = filters.city || filters.zip_code || filters.bedrooms || filters.bathrooms ||
    filters.min_price || filters.max_price || filters.min_sqft || (filters.property_types?.length > 0) ||
    filters.min_garage_spaces || filters.private_pool || filters.single_story;

  // Fetch properties with Supabase filtering and pagination
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties', filters, currentPage, userLocation?.lat],
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

      // Ordering
      query = query.order('created_at', { ascending: false });

      // If user has location and no specific filters, fetch more and sort by distance
      if (userLocation && !hasActiveFilters && currentPage === 1) {
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

  return (
    <div className="min-h-screen">
      {isRefreshing && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-white rounded-full px-4 py-2 shadow-lg">
          <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
        </div>
      )}

      {/* Hero Section */}
      <div className="relative h-[40vh] overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1920&q=80)',
          }}
        >
          <div className="absolute inset-0 bg-black/40"></div>
        </div>

        <div className="relative z-10 h-full flex items-center justify-center">
          <div className="text-center max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-white text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
              Find Your Dream Home
            </h1>
            <p className="text-white text-lg md:text-xl">
              Search active ARMLS listings with intelligent AI-powered search
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
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
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {totalCount > PAGE_SIZE ? `${PAGE_SIZE}+` : totalCount} {totalCount === 1 ? 'Home' : 'Homes'} Available
                </h2>
                <p className="text-slate-600 mt-1">
                  {userLocation && !hasActiveFilters ? 'Sorted by distance from you' : 'Showing active listings'}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className={`select-none ${viewMode === 'grid' ? 'bg-slate-800' : ''}`}
                >
                  <Grid3x3 className="h-4 w-4 mr-2" />
                  Grid
                </Button>
                <Button
                  variant={viewMode === 'map' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('map')}
                  className={`select-none ${viewMode === 'map' ? 'bg-slate-800' : ''}`}
                >
                  <Map className="h-4 w-4 mr-2" />
                  Map
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
              </div>
            ) : properties.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-slate-600 text-lg">No properties match your search criteria.</p>
                <p className="text-slate-500 mt-2">Try adjusting your filters.</p>
              </div>
            ) : viewMode === 'map' ? (
              <PropertyMap
                properties={properties}
                onFavorite={handleFavorite}
                savedPropertyIds={savedPropertyIds}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    <span className="text-slate-600 font-medium">
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

            {user && !isLoading && properties.length > 0 && (
              <RecommendedProperties
                user={user}
                savedPropertyIds={savedPropertyIds}
                onFavorite={handleFavorite}
              />
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
          <div className="bg-slate-900 text-white rounded-full shadow-2xl px-6 py-4 flex items-center gap-4">
            <Scale className="h-5 w-5" />
            <span className="font-medium">
              {comparePropertyIds.length} {comparePropertyIds.length === 1 ? 'property' : 'properties'} selected
            </span>
            <div className="flex items-center gap-2">
              {comparePropertyIds.length >= 2 && (
                <Link to={createPageUrl('PropertyCompare') + `?ids=${comparePropertyIds.join(',')}`}>
                  <Button size="sm" className="bg-white text-slate-900 hover:bg-slate-100 select-none">
                    Compare Now
                  </Button>
                </Link>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setComparePropertyIds([])}
                className="text-white hover:bg-white/20 select-none"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {comparePropertyIds.length < 2 && (
              <span className="text-slate-300 text-sm">Select at least 2 properties</span>
            )}
            {comparePropertyIds.length >= 4 && (
              <span className="text-amber-300 text-sm">Max 4 properties</span>
            )}
          </div>
        </div>
      )}

      {/* AI Assistant */}
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
