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
        // ====================================================================
        // FEATURED LISTINGS — scoped to Tanner Crandell's owned inventory
        // --------------------------------------------------------------------
        // Matched on Tanner's ARMLS agent ID in the list_agent_mls_id column.
        // The value is stored lowercase in the Spark Replication data ("pc295"
        // not "PC295") so we match on the lowercase form exactly with .eq().
        // ilike is avoided here because the column isn't indexed for pattern
        // matching and times out at ~60s on the full 26k-row table.
        //
        // If Tanner ever has zero active listings, the Featured Listings
        // section hides entirely via the {featuredProperties.length > 0}
        // conditional in the JSX below — no fallback needed.
        // ====================================================================
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

        // Total active listings count — used by the hero text
        // ("Search every active listing, backed by X homes from ARMLS")
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

      {/* HERO — search bar IS the call to action */}
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
              Finding your<br />perfect home.
            </h1>

            <p className="text-white/80 text-lg md:text-xl mb-8 max-w-xl">
              Search every active listing in Arizona,
              {totalListings ? <> backed by <span className="font-semibold text-white">{totalListings.toLocaleString?.() || totalListings}</span> homes from ARMLS</> : ' backed by the full ARMLS feed'},
              and shown to you by the Crandell Real Estate Team.
            </p>

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

      {/* MEET THE TEAM STRIP */}
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
              <div className="flex -space-x-3">
                {TEAM_MEMBERS.map((member) => (
                  <img
                    key={member.name}
                    src={member.photo}
                    alt={member.name}
                    className="w-14 h-14 md:w-16 md:h-16 rounded-full border-2 border-white object-cover bg-muted shadow-md"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ))}
              </div>

              {/* Meet the team button — links to the main Crandell site */}
              <a
                href="https://crandellrealestate.com/our-team/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  className="border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground whitespace-nowrap"
                >
                  Meet the team
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED LISTINGS */}
      <section className="py-16 md:py-20">
        <div className="crandell-container">
          {featuredProperties.length > 0 ? (
            <div className="mb-16">
              <div className="text-center mb-12 max-w-2xl mx-auto">
                <p className="text-primary uppercase tracking-wider text-sm font-semibold mb-2">
                  Our current listings
                </p>
                <h2 className="text-foreground font-normal mb-4">
                  Homes we're listing now
                </h2>
                <p className="text-muted-foreground">
                  The homes Tanner and the Crandell Real Estate Team are currently
                  representing across Arizona. For the full MLS with {totalListings || 'thousands of'} active
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
                Browse all {totalListings ? totalListings.toLocaleString?.() || totalListings : ''} homes
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
