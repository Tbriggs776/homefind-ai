import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchProperty, toggleSaveProperty, fetchSavedPropertyIds, logPageView } from '@/api/useSupabase';
import { useAuth } from '@/lib/AuthContext';
import { ListingAttribution, ARMLSSourceBadge } from '@/components/ARMLSCompliance';

function formatPrice(price) {
  if (!price) return '—';
  return '$' + Number(price).toLocaleString();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSaved, setIsSaved] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { property: p, error: e } = await fetchProperty(id);
      if (e || !p) {
        setError('Listing not found.');
        setLoading(false);
        return;
      }
      setProperty(p);
      setLoading(false);

      // Log page view
      logPageView(p.id, user?.id);

      // Check if saved
      if (user) {
        const { ids } = await fetchSavedPropertyIds(user.id);
        setIsSaved(ids.includes(p.id));
      }
    }
    load();
  }, [id, user]);

  async function handleToggleSave() {
    if (!user || !property) return;
    const { saved } = await toggleSaveProperty(user.id, property.id);
    setIsSaved(saved);
  }

  if (loading) return <div className="spinner" />;
  if (error) return (
    <div className="empty-state">
      <h3>{error}</h3>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/search')}>
        Back to Search
      </button>
    </div>
  );

  const photos = property.photos || property.photo_urls || [];
  const features = [
    ['Property Type', property.property_type],
    ['Bedrooms', property.bedrooms],
    ['Bathrooms', property.bathrooms],
    ['Square Feet', property.square_feet ? Number(property.square_feet).toLocaleString() : null],
    ['Lot Size', property.lot_size_acres ? `${property.lot_size_acres} acres` : null],
    ['Year Built', property.year_built],
    ['Garage', property.garage_spaces ? `${property.garage_spaces} spaces` : null],
    ['Pool', property.has_pool ? 'Yes' : 'No'],
    ['HOA', property.hoa_fee ? `$${property.hoa_fee}/mo` : 'None'],
    ['MLS #', property.mls_number],
    ['Listed', formatDate(property.list_date)],
    ['Days on Market', property.days_on_market],
    ['Subdivision', property.subdivision],
    ['County', property.county],
  ].filter(([, v]) => v != null && v !== '');

  return (
    <div className="detail-container">
      {/* Back */}
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={() => navigate(-1)}>
        ← Back
      </button>

      {/* Gallery */}
      {photos.length > 0 ? (
        <div style={{ marginBottom: 32 }}>
          <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 8 }}>
            <img
              src={photos[activePhoto]}
              alt={property.address}
              style={{ width: '100%', height: 480, objectFit: 'cover', background: 'var(--color-border-light)' }}
            />
          </div>
          {photos.length > 1 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
              {photos.slice(0, 20).map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Photo ${i + 1}`}
                  onClick={() => setActivePhoto(i)}
                  style={{
                    width: 80, height: 56, objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: i === activePhoto ? '2px solid var(--color-accent)' : '2px solid transparent',
                    opacity: i === activePhoto ? 1 : 0.6,
                    transition: 'all var(--transition)',
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          height: 300, background: 'var(--color-border-light)', borderRadius: 'var(--radius-lg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#bbb', fontSize: '1rem', marginBottom: 32,
        }}>
          No Photos Available
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <div className="detail-price">{formatPrice(property.price)}</div>
            <ARMLSSourceBadge />
          </div>
          <div className="detail-meta">
            {property.bedrooms && <span>{property.bedrooms} Beds</span>}
            {property.bathrooms && <span>{property.bathrooms} Baths</span>}
            {property.square_feet && <span>{Number(property.square_feet).toLocaleString()} Sqft</span>}
          </div>
          <div className="detail-address">
            {property.address}, {property.city}, {property.state} {property.zip_code}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {user && (
            <button className="btn btn-secondary" onClick={handleToggleSave}>
              {isSaved ? '♥ Saved' : '♡ Save'}
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      {property.description && (
        <div className="detail-section">
          <h2>About This Property</h2>
          <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {property.description}
          </p>
        </div>
      )}

      {/* Features Grid */}
      <div className="detail-section">
        <h2>Property Details</h2>
        <div className="detail-features">
          {features.map(([label, value]) => (
            <div key={label} className="detail-feature">
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ARMLS Rule 23.2.12: Listing Attribution */}
      <div className="detail-section">
        <h2>Listing Information</h2>
        <ListingAttribution
          listingOfficeName={property.listing_office_name}
          listingAgentName={property.listing_agent_name}
          listingAgentEmail={property.listing_agent_email}
          listingAgentPhone={property.listing_agent_phone}
        />
      </div>
    </div>
  );
}
