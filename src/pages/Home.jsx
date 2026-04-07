import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Loader2, Search, MapPin, ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import PropertyCard from '../components/properties/PropertyCard';
import RecentlyViewed from '../components/home/RecentlyViewed';

// Quick-filter chips for the East Valley cities Crandell specializes in.
// Click to deep-link into the search page with the city pre-filtered.
const QUICK_CITIES = [
  'Queen Creek',
  'San Tan Valley',
  'Gilbert',
  'Mesa',
  'Chandler',
];

// Team members for the "Meet the Team" strip below the hero.
// Replace photo paths with real headshots once available — drop the files
// into public/team/ and they'll resolve automatically.
const TEAM_MEMBERS = [
  { name: 'Tanner Crandell', role: 'Team Lead', photo: '/team/tanner.jpg' },
  { name: 'Denver Lane', role: 'Broker', photo: '/team/denver.jpg' },
  { name: 'Crandell Team', role: 'Agents', photo: '/team/team-3.jpg' },
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

      // Authenticated-user side effects (preserved from original file)
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
      // Pass the search query as a URL param so the search page picks it up
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

      {/* ====================================================================
          PERSONALIZED WELCOME BANNER (logged-in users only)
          --------------------------------------------------------------------
          Small, restrained, doesn't compete with the hero. Lives ABOVE the
          hero so the primary search action is always the same first thing
          every visitor sees regardless of auth state.
          ==================================================================== */}
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

      {/* ====================================================================
          HERO — search bar IS the call to action
          --------------------------------------------------------------------
          Dark charcoal background, no stock photo, no aspirational copy.
          The trustworthy-local anchor lives in the eyebrow and headline.
          The search bar is the primary action, with quick city chips below
          for buyers who want to start by browsing a specific area.
          ==================================================================== */}
      <section className="relative bg-secondary text-white overflow-hidden">
        {/* Subtle gradient background — replace with a real Crandell-listed
            Queen Creek property photo when one is available. Keeps things
            on-brand without committing to a specific stock image. */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-secondary via-secondary to-[#1a2332]"
          aria-hidden="true"
        />

        <div className="crandell-container relative py-16 md:py-24 lg:py-28">
          <div className="max-w-3xl">
            {/* Eyebrow — establishes brand and intent */}
            <p className="text-primary uppercase tracking-wider text-sm font-semibold mb-3">
              Crandell Home Intelligence
            </p>

            {/* Headline — Roboto 400 (editorial, light) per brand */}
            <h1 className="text-white font-normal leading-tight mb-4" style={{ fontSize: 'var(--crandell-text-display)' }}>
              Finding your<br />perfect home.
            </h1>

            {/* Subhead — concrete and local-anchored, no maintenance commitments */}
            <p className="text-white/80 text-lg md:text-xl mb-8 max-w-xl">
              Search every active listing in Arizona,
              {totalListings ? <> backed by <span className="font-semibold text-white">{totalListings.toLocaleString?.() || totalListings}</span> homes from ARMLS</> : ' backed by the full ARMLS feed'},
              and shown to you by the Crandell Real Estate Team.
            </p>

            {/* SEARCH BAR — the primary CTA */}
            <form
              onSubmit={handleHeroSearch}
              className="bg-white rounded-lg shadow-2xl p-2 flex items-center gap-2 max-w-2xl"
            >
              <Search className="w-5 h-5 text-muted-foreground ml-3 flex-shrink-0" />
              <input
                type="text"
                placeholder="City, neighborhood, ZIP, or address"
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

            {/* Quick-filter city chips — start a search by area */}
            <div className="flex flex-wrap gap-2 mt-5">
              <span className="text-white/60 text-sm self-center mr-1">Browse by city:</span>
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

      {/* ====================================================================
          MEET THE TEAM STRIP
          --------------------------------------------------------------------
          The trustworthy-local anchor. Tanner and the team are visible
          immediately below the hero, before any listings. This is the
          single most important section in the entire homepage rebuild —
          it's what separates HomeFind from a generic IDX clone.
          ==================================================================== */}
      <section className="bg-muted py-12 md:py-16">
        <div className="crandell-container">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2 font-semibold">
                Local. Always.
              </p>
              <h2 className="text-foreground font-normal mb-3">
                The Crandell Real Estate Team
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                We live in Queen Creek. We list in Queen Creek. We close in Queen Creek.
                When you find a home on this site, you'll be touring it with us — not
                a stranger from a referral pool.
              </p>
            </div>

            <div className="flex items-center gap-6">
              {/* Team photo stack — placeholder paths.
                  Replace files in public/team/ with real headshots
                  (jpg or png, ~200x200px, square crop). */}
              <div className="flex -space-x-3">
                {TEAM_MEMBERS.map((member) => (
                  <img
                    key={member.name}
                    src={member.photo}
                    alt={member.name}
                    className="w-14 h-14 md:w-16 md:h-16 rounded-full border-2 border-white object-cover bg-muted shadow-md"
                    onError={(e) => {
                      // Graceful fallback while real headshots aren't yet uploaded
                      e.target.style.display = 'none';
                    }}
                  />
                ))}
              </div>

              <Button
                variant="outline"
                className="border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground whitespace-nowrap"
              >
                Meet the team
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          FEATURED LISTINGS
          --------------------------------------------------------------------
          Existing functionality — same data fetch, same PropertyCard,
          same favorite handling. Only the heading styling changes.
          ==================================================================== */}
      <section className="py-16 md:py-20">
        <div className="crandell-container">
          {featuredProperties.length > 0 ? (
            <div className="mb-16">
              <div className="text-center mb-12 max-w-2xl mx-auto">
                <p className="text-primary uppercase tracking-wider text-sm font-semibold mb-2">
                  Hand-picked by our team
                </p>
                <h2 className="text-foreground font-normal mb-4">
                  Our Featured Listings
                </h2>
                <p className="text-muted-foreground">
                  A curated selection of properties from the Crandell Real Estate Team.
                  For the full Arizona MLS with {totalListings || 'thousands of'} active
                  listings, use our search.
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

          {/* Recently Viewed Section — preserved from original */}
          {user && (
            <RecentlyViewed
              user={user}
              onFavorite={handleFavorite}
              savedPropertyIds={savedPropertyIds}
            />
          )}

          {/* Browse All Homes CTA — uses brand primary */}
          <div className="text-center mt-12">
            <Link to={createPageUrl('Search')}>
              <Button className="bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground font-semibold px-10 py-6 text-lg">
                Browse all {totalListings ? totalListings.toLocaleString?.() || totalListings : ''} homes
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
