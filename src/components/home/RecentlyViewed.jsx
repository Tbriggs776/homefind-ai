import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import PropertyCard from '../properties/PropertyCard';
import { Loader2, Clock } from 'lucide-react';

export default function RecentlyViewed({ user, onFavorite, savedPropertyIds = [] }) {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchRecentlyViewed = async () => {
      try {
        // Get recently viewed properties for this user
        const { data: views, error: viewsError } = await supabase
          .from('property_views')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (viewsError) throw viewsError;

        if (!views || views.length === 0) {
          setProperties([]);
          setLoading(false);
          return;
        }

        // Get unique property IDs (most recent first)
        const uniquePropertyIds = [...new Set(views.map(v => v.property_id))].slice(0, 6);

        // Fetch the actual properties
        const { data: allProperties, error: propsError } = await supabase
          .from('properties')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(2000);

        if (propsError) throw propsError;

        const viewedProperties = allProperties.filter(p => uniquePropertyIds.includes(p.id));

        // Sort by the order they appear in uniquePropertyIds (most recent first)
        const sorted = uniquePropertyIds.map(id => viewedProperties.find(p => p.id === id)).filter(Boolean);
        setProperties(sorted);
      } catch (error) {
        console.error('Error fetching recently viewed:', error);
        setProperties([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentlyViewed();
  }, [user]);

  if (!loading && properties.length === 0) {
    return null;
  }

  return (
    <div className="mt-12 pt-8 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-6">
        <Clock className="h-6 w-6 text-slate-500" />
        <h2 className="text-2xl font-bold text-slate-900">
          Recently Viewed
        </h2>
        <p className="text-sm text-slate-600 ml-auto">
          Properties you've recently browsed
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map(property => (
            <PropertyCard
              key={property.id}
              property={property}
              onFavorite={onFavorite}
              isFavorited={savedPropertyIds.includes(property.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}