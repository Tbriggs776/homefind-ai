import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchFeaturedListings } from '@/api/useSupabase';
import ListingCard from '@/components/ListingCard';

export default function Home() {
  const [query, setQuery] = useState('');
  const [featured, setFeatured] = useState([]);
  const [totalActive, setTotalActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      const { properties, totalActive: total } = await fetchFeaturedListings();
      setFeatured(properties);
      setTotalActive(total);
      setLoading(false);
    }
    load();
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    } else {
      navigate('/search');
    }
  }

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <h1>Find Your Arizona Home</h1>
        <p>
          Search {totalActive > 0 ? totalActive.toLocaleString() : '1,000+'} active listings
          across the Valley, powered by ARMLS.
        </p>
        <form className="search-bar" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="City, ZIP, address, or neighborhood..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
      </section>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat">
          <div className="stat-number">{totalActive > 0 ? totalActive.toLocaleString() : '—'}</div>
          <div className="stat-label">Active Listings</div>
        </div>
        <div className="stat">
          <div className="stat-number">ARMLS</div>
          <div className="stat-label">IDX Data Source</div>
        </div>
        <div className="stat">
          <div className="stat-number">12hr</div>
          <div className="stat-label">Data Refresh</div>
        </div>
      </div>

      {/* Featured / Agent Listings */}
      <section style={{ maxWidth: 1400, margin: '0 auto', padding: '40px 24px 20px' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.5rem',
          fontWeight: 600,
          marginBottom: 4,
        }}>
          Crandell Team Listings
        </h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem', marginBottom: 24 }}>
          Properties listed by the Crandell Real Estate Team at Balboa Realty
        </p>
      </section>

      {loading ? (
        <div className="spinner" />
      ) : featured.length > 0 ? (
        <div className="listing-grid" style={{ maxWidth: 1400, margin: '0 auto' }}>
          {featured.map((p) => (
            <ListingCard key={p.id} property={p} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No featured listings right now</h3>
          <p>Browse all active listings instead.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/search')}>
            Search All Listings
          </button>
        </div>
      )}

      {/* CTA */}
      <section style={{ textAlign: 'center', padding: '48px 24px 64px' }}>
        <button className="btn btn-primary" style={{ fontSize: '1rem', padding: '14px 32px' }} onClick={() => navigate('/search')}>
          Browse All Listings
        </button>
      </section>
    </>
  );
}
