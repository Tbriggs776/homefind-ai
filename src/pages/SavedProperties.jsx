import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import PropertyCard from '../components/properties/PropertyCard';
import RecommendedProperties from '../components/recommendations/RecommendedProperties';
import { Loader2, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { createPageUrl } from '@/utils';
import { Navigate } from 'react-router-dom';

export default function SavedProperties() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [sortBy, setSortBy] = useState('newest');
  const [filterType, setFilterType] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const { data: savedProperties = [], isLoading, refetch } = useQuery({
    queryKey: ['savedProperties', user?.id],
    queryFn: async () => {
      if (!user) return [];

      // Get saved property IDs
      const { data: saved } = await supabase
        .from('saved_properties')
        .select('property_id')
        .eq('user_id', user.id);

      const propertyIds = (saved || []).map(s => s.property_id);
      if (propertyIds.length === 0) return [];

      // Fetch properties by IDs
      const { data: properties } = await supabase
        .from('properties')
        .select('*')
        .in('id', propertyIds)
        .order('created_at', { ascending: false });

      return properties || [];
    },
    enabled: !!user
  });

  const handleRemoveFavorite = async (property) => {
    const { data: saved } = await supabase
      .from('saved_properties')
      .select('id')
      .eq('user_id', user.id)
      .eq('property_id', property.id);

    if (saved && saved.length > 0) {
      await supabase.from('saved_properties').delete().eq('id', saved[0].id);
      refetch();
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/Login" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">Saved Properties</h1>
          <p className="text-slate-600">Your favorite homes all in one place</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
          </div>
        ) : savedProperties.length === 0 ? (
          <div className="text-center py-20">
            <Heart className="h-16 w-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">No Saved Properties</h2>
            <p className="text-slate-600 mb-6">Start saving homes you love to keep track of them</p>
            <Button onClick={() => window.location.href = createPageUrl('Search')} className="bg-slate-800 hover:bg-slate-700">
              Search Properties
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-8 bg-white rounded-lg p-6 shadow-sm border border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-2">Sort By</label>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest Saved</SelectItem>
                      <SelectItem value="price-low">Price: Low to High</SelectItem>
                      <SelectItem value="price-high">Price: High to Low</SelectItem>
                      <SelectItem value="beds">Bedrooms</SelectItem>
                      <SelectItem value="sqft">Square Footage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-2">Property Type</label>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="single_family">Single Family</SelectItem>
                      <SelectItem value="condo">Condo</SelectItem>
                      <SelectItem value="townhouse">Townhouse</SelectItem>
                      <SelectItem value="multi_family">Multi Family</SelectItem>
                      <SelectItem value="land">Land</SelectItem>
                      <SelectItem value="new_construction">New Construction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-2">Min Price</label>
                  <Input type="number" placeholder="$0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-2">Max Price</label>
                  <Input type="number" placeholder="$999,999" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(() => {
                let filtered = [...savedProperties];
                if (filterType !== 'all') filtered = filtered.filter(p => p.property_type === filterType);
                if (minPrice) filtered = filtered.filter(p => p.price >= parseFloat(minPrice));
                if (maxPrice) filtered = filtered.filter(p => p.price <= parseFloat(maxPrice));
                if (sortBy === 'price-low') filtered.sort((a, b) => a.price - b.price);
                else if (sortBy === 'price-high') filtered.sort((a, b) => b.price - a.price);
                else if (sortBy === 'beds') filtered.sort((a, b) => (b.bedrooms || 0) - (a.bedrooms || 0));
                else if (sortBy === 'sqft') filtered.sort((a, b) => (b.square_feet || 0) - (a.square_feet || 0));
                return filtered.map(property => (
                  <PropertyCard key={property.id} property={property} onFavorite={handleRemoveFavorite} isFavorited={true} />
                ));
              })()}
            </div>

            {savedProperties.length > 0 && (
              <RecommendedProperties
                user={user}
                savedPropertyIds={savedProperties.map(p => p.id)}
                onFavorite={async (property) => {
                  const { data: existing } = await supabase
                    .from('saved_properties')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('property_id', property.id);
                  if (!existing || existing.length === 0) {
                    await supabase.from('saved_properties').insert({ user_id: user.id, property_id: property.id });
                    refetch();
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
