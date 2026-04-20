import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Loader2, Search, ArrowRight, Home as HomeIcon, DollarSign, CheckCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import PropertyCard from '../components/properties/PropertyCard';
import RecentlyViewed from '../components/home/RecentlyViewed';

// Quick-filter chips for the East Valley cities Crandell specializes in.
const QUICK_CITIES = [
  'Queen Creek',
  'San Tan Valley',
  'Gilbert',
  'Mesa',
  'Chandler',
];

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [featuredProperties, setFeaturedProperties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savedPropertyIds, setSavedPropertyIds] = useState([]);
  const [totalListings, setTotalListings] = useState('');
  const [heroSearchValue, setHeroSearchValue] = useState('');
  const [selectedCities, setSelectedCities] = useState([]);

  useEffect(() => {
    const initPage = async () => {
      setLoading(true);
      try {
        const TANNER_AGENT_ID = 'pc295';

        const primaryResult = await supabase
          .from('properties')
          .select('*')
          .in('status', ['active', 'coming_soon'])
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)
          .eq('list_agent_mls_id', TANNER_AGENT_ID)
          .order('created_at', { ascending: false })
          .limit(8);

        let featured = primaryResult.data || [];

        if (primaryResult.error) {
          console.error('Featured listings query error:', JSON.stringify(primaryResult.error));
        }

        setFeaturedProperties(featured);

        const countResult = await supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .in('status', ['active', 'coming_soon']);

        if (countResult.count !== null && countResult.count !== undefined) {
          setTotalListings(countResult.count.toLocaleString());
        }
      } catch (error) {
        console.error('Error fetching featured properties:', error);
        setFeaturedProperties([]);
      } finally {
        setLoading(false);
      }

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

  const handleHeroSearch = (e) => {
    e.preventDefault();
    const trimmed = heroSearchValue.trim();
    if (trimmed) {
      navigate(`${createPageUrl('Search')}?q=${encodeURIComponent(trimmed)}`);
    } else {
      navigate(createPageUrl('Search'));
    }
  };

  const toggleCity = (city) => {
    setSelectedCities(prev =>
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
    );
  };

  const handleSearchCities = () => {
    if (selectedCities.length === 0) return;
    navigate(`${createPageUrl('Search')}?city=${encodeURIComponent(selectedCities.join(','))}`);
  };

  const firstName = user?.full_name?.split(' ')[0];

  return (
    <div className="min-h-screen bg-background">

      {/* Personalized welcome banner — logged-in only */}
      {user && firstName && (
        <div className="bg-secondary text-secondary-foreground">
          <div className="crandell-container py-2 flex items-center justify-between text-sm">
            <span>
              Welcome back, <span className="font-semibold">{firstName}</span>.
            </span>
            <Link
              to={createPageUrl('SavedProperties')}
              className="text-primary hover:underline flex items-center gap-1"
            >
              Your saved homes <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* ================================================================
          HERO SECTION — split layout: text left, property photo right
          ================================================================ */}
      <section className="relative bg-secondary text-white overflow-hidden">
        <div
          className="absolute inset-0 bg-gradient-to-br from-secondary via-secondary to-[#1a2332]"
          aria-hidden="true"
        />

        {/* Hero image — absolutely positioned to fill right half on desktop */}
        <div className="absolute top-0 right-0 bottom-0 w-1/2 hidden lg:block">
          <img
            src="/hero-home.jpg"
            alt="Luxury Arizona home at sunset"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Gradient fade from dark left into image */}
          <div className="absolute inset-0 bg-gradient-to-r from-secondary via-secondary/50 to-transparent w-1/3" />
        </div>

        <div className="crandell-container relative">
          <div className="max-w-xl py-16 md:py-24 lg:py-28">
              <p className="text-primary uppercase tracking-wider text-sm font-semibold mb-3">
                Crandell Home Intelligence
              </p>

              <h1 className="text-white font-normal leading-tight mb-4" style={{ fontSize: 'var(--crandell-text-display)' }}>
                Find the right home.<br />Not just the next one.
              </h1>

              <p className="text-white/80 text-lg md:text-xl mb-8 max-w-xl">
                Every active home in Arizona. Smarter search. Better decisions. Backed by the Crandell Real Estate Team.
              </p>

              <form
                onSubmit={handleHeroSearch}
                className="bg-white rounded-lg shadow-2xl p-2 flex items-center gap-2 max-w-xl"
              >
                <Search className="w-5 h-5 text-muted-foreground ml-3 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="City, neighborhood, address… or just start exploring"
                  value={heroSearchValue}
                  onChange={(e) => setHeroSearchValue(e.target.value)}
                  className="flex-1 px-2 py-3 text-base text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 min-w-0"
                />
                <Button
                  type="submit"
                  className="bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground px-6 py-6 font-semibold whitespace-nowrap"
                >
                  Search Homes
                </Button>
              </form>

              {/* Trust line with checkmark */}
              <div className="flex items-start gap-2 mt-4 max-w-xl">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-white/60 text-sm">
                  Used by buyers across Queen Creek and the East Valley to find homes before they're gone.
                </p>
              </div>

              {/* Quick city chips — toggle to stack multiple, then Search */}
              <div className="flex flex-wrap gap-2 mt-5">
                <span className="text-white/60 text-sm self-center mr-1">
                  {selectedCities.length > 0 ? 'Searching:' : 'Start with the areas we know best:'}
                </span>
                {QUICK_CITIES.map((city) => {
                  const isSelected = selectedCities.includes(city);
                  return (
                    <button
                      key={city}
                      onClick={() => toggleCity(city)}
                      aria-pressed={isSelected}
                      className={`text-sm px-4 py-2 rounded-full transition-colors backdrop-blur-sm ${
                        isSelected
                          ? 'bg-primary text-primary-foreground hover:bg-[var(--crandell-primary-hover)]'
                          : 'bg-white/10 hover:bg-white/20 text-white'
                      }`}
                    >
                      {city}
                    </button>
                  );
                })}
              </div>
              {selectedCities.length > 0 && (
                <div className="mt-3">
                  <Button
                    type="button"
                    onClick={handleSearchCities}
                    className="bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground px-5 py-5 font-semibold"
                  >
                    Search {selectedCities.length} {selectedCities.length === 1 ? 'city' : 'cities'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
          </div>
        </div>
      </section>

      {/* ================================================================
          NOT SURE WHERE TO START? — three-column: two cards + buttons
          ================================================================ */}
      <section className="bg-white py-12 md:py-16 border-b border-border">
        <div className="crandell-container">
          <h2 className="text-center text-foreground font-normal mb-8 text-2xl md:text-3xl">
            Not sure where to start?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto items-start">
            {/* Search Homes card */}
            <Link
              to={createPageUrl('Search')}
              className="group border border-border rounded-xl p-6 md:p-8 hover:border-primary hover:shadow-md transition-all text-center"
            >
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <HomeIcon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Search Homes</h3>
              <p className="text-muted-foreground text-sm">
                Explore everything available right now.
              </p>
            </Link>

            {/* Sell Before You Buy card */}
            <a
              href="https://crandellrealestate.com/sell/"
              target="_blank"
              rel="noopener noreferrer"
              className="group border border-border rounded-xl p-6 md:p-8 hover:border-primary hover:shadow-md transition-all text-center"
            >
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Sell Before You Buy</h3>
              <p className="text-muted-foreground text-sm">
                Get a strategy for timing, pricing, and maximizing your equity.
              </p>
            </a>

            {/* Stacked CTA buttons */}
            <div className="flex flex-col gap-3 justify-center h-full">
              <a
                href="https://crandellrealestate.com/our-team/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  className="w-full border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground py-6 text-base font-semibold"
                >
                  Meet the Team
                </Button>
              </a>
              <a
                href="https://crandellrealestate.com/sell/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  className="w-full bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground py-6 text-base font-semibold"
                >
                  Sell First
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          LOCAL. ALWAYS. — team section with wide rectangular photo
          ================================================================ */}
      <section className="bg-muted py-12 md:py-16">
        <div className="crandell-container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Left column — text */}
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2 font-semibold">
                Local. Always.
              </p>
              <h2 className="text-foreground font-normal mb-4">
                The Crandell Real Estate Team
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-3">
                We don't just work in Queen Creek. We live here.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-3">
                Every showing, every offer, every decision is backed by real, local insight, not guesswork.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                When you work with us, you're not getting a random agent. You're getting a strategy built around how this market actually moves.
              </p>
            </div>

            {/* Right column — wide team photo (clickable) */}
            <a
              href="https://crandellrealestate.com/our-team/"
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:opacity-90 transition-opacity"
            >
              <img
                src="/team/team_crandell.jpg"
                alt="The Crandell Real Estate Team"
                className="w-full rounded-xl object-cover shadow-lg cursor-pointer"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </a>
          </div>
        </div>
      </section>

      {/* ================================================================
          FEATURED LISTINGS — Crandell team's active inventory
          ================================================================ */}
      <section className="py-16 md:py-20">
        <div className="crandell-container">
          {featuredProperties.length > 0 ? (
            <div className="mb-16">
              <div className="text-center mb-12 max-w-2xl mx-auto">
                <p className="text-primary uppercase tracking-wider text-sm font-semibold mb-2">
                  Our Current Listings
                </p>
                <h2 className="text-foreground font-normal mb-4">
                  Homes we're actively representing
                </h2>
                <p className="text-muted-foreground">
                  These are homes we know inside and out. If one stands out, we can give you real insight beyond what you see online.
                </p>
              </div>

              {loading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : null}

          {user && (
            <RecentlyViewed
              user={user}
              onFavorite={handleFavorite}
              savedPropertyIds={savedPropertyIds}
            />
          )}

          <div className="text-center mt-12">
            <Link to={createPageUrl('Search')}>
              <Button className="bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground font-semibold px-10 py-6 text-lg">
                Search All Arizona Homes
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
