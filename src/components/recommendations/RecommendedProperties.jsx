import React, { useState, useEffect } from 'react';
import { invokeFunction } from '@/api/supabaseClient';
import PropertyCard from '../properties/PropertyCard';
import { Loader2, Sparkles } from 'lucide-react';

export default function RecommendedProperties({ user, savedPropertyIds = [], onFavorite }) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchRecommendations = async () => {
      try {
        const result = await invokeFunction('getPersonalizedRecommendations', {});
        setRecommendations(result?.recommendations || []);
      } catch (error) {
        console.error('Error fetching recommendations:', error);
        setRecommendations([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [user]);

  if (!loading && recommendations.length === 0) {
    return null;
  }

  return (
    <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="h-6 w-6 text-amber-500" />
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
          Recommended for You
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 ml-auto">
          Based on your preferences & activity
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-600 dark:text-slate-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recommendations.map(property => (
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