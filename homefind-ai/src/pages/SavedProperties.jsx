import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSavedProperties, fetchSavedPropertyIds, toggleSaveProperty } from '@/api/useSupabase';
import { useAuth } from '@/lib/AuthContext';
import ListingCard from '@/components/ListingCard';

export default function SavedProperties() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    async function load() {
      const [{ properties: props }, { ids }] = await Promise.all([
        fetchSavedProperties(user.id),
        fetchSavedPropertyIds(user.id),
      ]);
      setProperties(props);
      setSavedIds(new Set(ids));
      setLoading(false);
    }
    load();
  }, [user, navigate]);

  async function handleToggleSave(propertyId) {
    if (!user) return;
    const { saved } = await toggleSaveProperty(user.id, propertyId);
    if (!saved) {
      setProperties(prev => prev.filter(p => p.id !== propertyId));
    }
    setSavedIds(prev => {
      const next = new Set(prev);
      saved ? next.add(propertyId) : next.delete(propertyId);
      return next;
    });
  }

  if (loading) return <div className="spinner" />;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: 4 }}>
        Saved Properties
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem', marginBottom: 24 }}>
        {properties.length} saved listing{properties.length !== 1 ? 's' : ''}
      </p>

      {properties.length > 0 ? (
        <div className="listing-grid" style={{ padding: 0 }}>
          {properties.map(p => (
            <ListingCard
              key={p.id}
              property={p}
              onToggleSave={handleToggleSave}
              isSaved={savedIds.has(p.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>No saved listings yet</h3>
          <p>Heart a listing from search results to save it here.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/search')}>
            Browse Listings
          </button>
        </div>
      )}
    </div>
  );
}
