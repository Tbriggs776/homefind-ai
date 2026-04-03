import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ARMLSSourceBadge } from './ARMLSCompliance';

function formatPrice(price) {
  if (!price) return '—';
  return '$' + Number(price).toLocaleString();
}

export default function ListingCard({ property, onToggleSave, isSaved }) {
  const navigate = useNavigate();
  const photos = property.photos || property.photo_urls || [];
  const primaryPhoto = photos[0] || property.primary_photo_url || null;

  return (
    <div className="listing-card" onClick={() => navigate(`/property/${property.id}`)}>
      {primaryPhoto ? (
        <img className="listing-card-img" src={primaryPhoto} alt={property.address || 'Listing'} loading="lazy" />
      ) : (
        <div className="listing-card-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: '0.875rem' }}>
          No Photo Available
        </div>
      )}
      <div className="listing-card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="listing-card-price">{formatPrice(property.price)}</div>
          {onToggleSave && (
            <button
              className={`save-btn ${isSaved ? 'saved' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleSave(property.id); }}
              title={isSaved ? 'Remove from saved' : 'Save listing'}
            >
              {isSaved ? '♥' : '♡'}
            </button>
          )}
        </div>
        <div className="listing-card-details">
          {property.bedrooms && <span>{property.bedrooms} bd</span>}
          {property.bathrooms && <span>{property.bathrooms} ba</span>}
          {property.square_feet && <span>{Number(property.square_feet).toLocaleString()} sqft</span>}
          {property.lot_size_acres && <span>{property.lot_size_acres} ac</span>}
        </div>
        <div className="listing-card-address">
          {property.address}
          {property.city && `, ${property.city}`}
          {property.state && ` ${property.state}`}
          {property.zip_code && ` ${property.zip_code}`}
        </div>
        <div className="listing-card-footer">
          <span className="listing-card-office">{property.listing_office_name || ''}</span>
          <ARMLSSourceBadge />
        </div>
      </div>
    </div>
  );
}
