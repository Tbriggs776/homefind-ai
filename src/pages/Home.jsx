import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Loader2, Home as HomeIcon, Heart } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import PropertyCard from '../components/properties/PropertyCard';
import RecentlyViewed from '../components/home/RecentlyViewed';

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [featuredProperties, setFeaturedProperties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savedPropertyIds, setSavedPropertyIds] = useState([]);
  const [totalListings, setTotalListings] = useState('');

  useEffect(() => {
    const initPage = async () => {
      // Fetch featured properties (works for all users)
      setLoading(true);
      try {
        const response = await invokeFunction('getFeaturedListings', {});
        const props = response?.properties || [];
        setFeaturedProperties(props);
        setTotalListings(response?.total_active_listings || '');
      } catch (error) {
        console.error('Error fetching featured properties:', error);
        setFeaturedProperties([]);
      } finally {
        setLoading(false);
      }

      // If authenticated, do user-specific tasks
      if (user) {
        try { await invokeFunction('markUserActive', { userId: user.id }); } catch {}
        try { await invokeFunction('sendWelcomeEmail', { userId: user.id }); } catch {}
        try { await invokeFunction('syncNewUserToFollowUpBoss', { userId: user.id }); } catch {}

        try {
          const { data: saved } = await supabase
            .from('saved_properties')
            .select('property_id')
            .eq('user_id', user.id);
          setSavedPropertyIds((saved || []).map(s => s.property_id));
        } catch {
          setSavedPropertyIds([]);
        }
      }
    };

    initPage();
  }, [user]);

  const handleFavorite = async (property) => {
    if (!user) {
      navigate('/Login');
      return;
    }

    const { data: existing } = await supabase
      .from('saved_properties')
      .select('id')
      .eq('user_id', user.id)
      .eq('property_id', property.id);

    if (existing && existing.length > 0) {
      await supabase.from('saved_properties').delete().eq('id', existing[0].id);
      setSavedPropertyIds(prev => prev.filter(id => id !== property.id));
    } else {
      await supabase.from('saved_properties').insert({
        user_id: user.id,
        property_id: property.id
      });
      setSavedPropertyIds(prev => [...prev, property.id]);
    }
  };

  if (!isAuthenticated) {
    // Not authenticated - show landing page
    return (
      <div className="min-h-screen bg-white">
        {/* Hero Section with Background Image */}
        <div className="relative h-[70vh] md:h-[80vh] overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: 'url(https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1920&q=80)',
            }}
          >
            <div className="absolute inset-0 bg-black/30"></div>
          </div>

          <div className="relative z-10 h-full flex items-center justify-center">
            <div className="text-center max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <h1 className="text-white text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                Unlock Your<br />
                <span className="text-6xl md:text-7xl lg:text-8xl">DREAM HOME</span>
              </h1>
              <div className="mt-12">
                <Link to={createPageUrl('Search')}>
                  <Button
                    size="lg"
                    className="bg-white text-slate-900 hover:bg-slate-100 text-lg px-10 py-7 select-none font-semibold"
                  >
                    FIND YOUR HOME
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Find Your Perfect Home Section */}
        <div className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-crandell-primary mb-6">
                Find Your Perfect Home
              </h2>
              <p className="text-lg text-slate-700 max-w-4xl mx-auto leading-relaxed">
                Looking for the ideal property? Our powerful property search tool makes it easy to discover your dream home.
                Whether you're a first-time homebuyer, a growing family, or seeking an investment opportunity, our listings
                cover a wide range of options. Start your search and get one step closer to unlocking your new home.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
              <div className="text-center p-6">
                <div className="h-16 w-16 bg-crandell-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <MapPin className="h-8 w-8 text-crandell-primary" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-4">Smart Search</h3>
                <p className="text-slate-600">
                  Find properties that match your exact criteria with advanced filtering options
                </p>
              </div>

              <div className="text-center p-6">
                <div className="h-16 w-16 bg-crandell-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Heart className="h-8 w-8 text-crandell-primary" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-4">Save Favorites</h3>
                <p className="text-slate-600">
                  Keep track of properties you love and get notified about updates
                </p>
              </div>

              <div className="text-center p-6">
                <div className="h-16 w-16 bg-crandell-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <HomeIcon className="h-8 w-8 text-crandell-primary" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-4">AI Assistance</h3>
                <p className="text-slate-600">
                  Get personalized recommendations powered by artificial intelligence
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated - show properties carousel
  return (
    <div className="min-h-screen bg-white">
      {/* Welcome Hero with Background */}
      <div className="relative h-[50vh] overflow-hidden mb-12">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1920&q=80)',
          }}
        >
          <div className="absolute inset-0 bg-black/40"></div>
        </div>

        <div className="relative z-10 h-full flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-white text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
              Welcome, {user?.full_name?.split(' ')[0] || 'Friend'}!
            </h1>
            <p className="text-white text-xl md:text-2xl flex items-center justify-center gap-2">
              <HomeIcon className="h-6 w-6" />
              {totalListings ? `Search ${totalListings} homes across Arizona` : 'Find your perfect home in Arizona'}
            </p>
            <div className="mt-6">
              <Link to={createPageUrl('Search')}>
                <Button size="lg" className="bg-crandell-primary hover:bg-crandell-primary-hover text-white text-lg px-8 py-6 font-semibold">
                  Search All Homes
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">

        {/* Featured Properties Section */}
        {featuredProperties.length > 0 ? (
          <div className="mb-16">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold text-crandell-primary mb-4">Our Featured Listings</h2>
              <p className="text-lg text-slate-700 max-w-3xl mx-auto">
                Hand-picked properties from our Balboa Realty agents. For the full Arizona MLS with {totalListings || 'thousands of'} active listings, use our search.
              </p>
            </div>

            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-hidden">
                {featuredProperties.map(property => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    onFavorite={handleFavorite}
                    isFavorited={savedPropertyIds.includes(property.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
          </div>
        ) : null}

        {/* Recently Viewed Section */}
        {user && (
          <RecentlyViewed
            user={user}
            onFavorite={handleFavorite}
            savedPropertyIds={savedPropertyIds}
          />
        )}

        {/* CTA Section */}
        <div className="text-center">
          <Link to={createPageUrl('Search')}>
            <Button className="bg-crandell-primary hover:bg-crandell-primary-hover text-white font-semibold px-10 py-6 text-lg">
              Browse All Homes
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
