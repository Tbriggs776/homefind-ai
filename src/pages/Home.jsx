import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Loader2, Search, ArrowRight, Home as HomeIcon, DollarSign } from 'lucide-react';
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

  const handleCityChip = (city) => {
    navigate(`${createPageUrl('Search')}?city=${encodeURIComponent(city)}`);
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
          HERO SECTION
          ================================================================ */}
      <section className="relative bg-secondary text-white overflow-hidden">
        <div
          className="absolute inset-0 bg-gradient-to-br from-secondary via-secondary to-[#1a2332]"
          aria-hidden="true"
        />

        <div className="crandell-container relative py-16 md:py-24 lg:py-28">
          <div className="max-w-3xl">
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
              className="bg-white rounded-lg shadow-2xl p-2 flex items-center gap-2 max-w-2xl"
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

            {/* Trust line */}
            <p className="text-white/50 text-sm mt-3 max-w-xl">
              Used by buyers across Queen Creek and the East Valley to find homes before they're gone.
            </p>

            {/* Quick city chips */}
            <div className="flex flex-wrap gap-2 mt-5">
              <span className="text-white/60 text-sm self-center mr-1">Start with the areas we know best:</span>
              {QUICK_CITIES.map((city) => (
                <button
                  key={city}
                  onClick={() => handleCityChip(city)}
                  className="bg-white/10 hover:bg-white/20 text-white text-sm px-4 py-2 rounded-full transition-colors backdrop-blur-sm"
                >
                  {city}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          NOT SURE WHERE TO START? — two-option CTA section
          ================================================================ */}
      <section className="bg-white py-12 md:py-16 border-b border-border">
        <div className="crandell-container">
          <h2 className="text-center text-foreground font-normal mb-8 text-2xl md:text-3xl">
            Not sure where to start?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Search Homes option */}
            <Link
              to={createPageUrl('Search')}
              className="group border border-border rounded-xl p-6 md:p-8 hover:border-primary hover:shadow-md transition-all text-center"
            >
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <HomeIcon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Search Homes</h3>
              <p className="text-muted-foreground text-sm">
                Explore everything available right now
              </p>
              <span className="inline-flex items-center gap-1 text-primary text-sm font-medium mt-4 group-hover:gap-2 transition-all">
                Start searching <ArrowRight className="h-4 w-4" />
              </span>
            </Link>

            {/* Sell Before You Buy option */}
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
                Get a strategy for timing, pricing, and maximizing your equity
              </p>
              <span className="inline-flex items-center gap-1 text-primary text-sm font-medium mt-4 group-hover:gap-2 transition-all">
                Learn more <ArrowRight className="h-4 w-4" />
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* ================================================================
          LOCAL. ALWAYS. — team section with photo + dual CTAs
          ================================================================ */}
      <section className="bg-muted py-12 md:py-16">
        <div className="crandell-container">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div className="max-w-xl">
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
                Every showing, every offer, every decision is backed by real, local insight — not guesswork.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                When you work with us, you're not getting a random agent. You're getting a strategy built around how this market actually moves.
              </p>
            </div>

            <div className="flex flex-col items-center gap-4">
              {/* Team photo */}
              <img
                src="/team/team_crandell.jpg"
                alt="The Crandell Real Estate Team"
                className="w-48 h-48 md:w-56 md:h-56 rounded-xl object-cover border-4 border-white shadow-lg"
                onError={(e) => { e.target.style.display = 'none'; }}
              />

              {/* Dual CTA buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="https://crandellrealestate.com/our-team/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button
                    variant="outline"
                    className="border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground whitespace-nowrap"
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
                    variant="outline"
                    className="border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground whitespace-nowrap"
                  >
                    Sell First
                  </Button>
                </a>
              </div>
            </div>
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
