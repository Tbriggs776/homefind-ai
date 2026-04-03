import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { Bed, Bath, Square, MapPin, Maximize2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default marker icon issue with webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function formatShortPrice(price) {
  if (price >= 1000000) return `$${(price / 1000000).toFixed(1)}M`;
  if (price >= 1000) return `$${Math.round(price / 1000)}K`;
  return `$${price}`;
}

function createPriceIcon(price) {
  const label = formatShortPrice(price);
  return L.divIcon({
    className: 'custom-price-marker',
    html: `<div style="
      background: #1e293b;
      color: white;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      border: 2px solid white;
      text-align: center;
      line-height: 1.2;
    ">${label}</div>`,
    iconSize: [70, 28],
    iconAnchor: [35, 28],
    popupAnchor: [0, -30],
  });
}

function MapBoundsHandler({ onBoundsChange }) {
  useMapEvents({
    moveend: (e) => {
      const bounds = e.target.getBounds();
      if (onBoundsChange) onBoundsChange(bounds);
    },
  });
  return null;
}

function FitBounds({ properties }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (properties.length > 0 && !fitted.current) {
      const bounds = L.latLngBounds(properties.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    }
  }, [properties, map]);

  return null;
}

function RefitButton({ properties }) {
  const map = useMap();

  const handleRefit = () => {
    if (properties.length > 0) {
      const bounds = L.latLngBounds(properties.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  };

  return (
    <button
      onClick={handleRefit}
      className="absolute top-3 right-3 z-[1000] bg-white rounded-lg shadow-md p-2 hover:bg-slate-50 border border-slate-200"
      title="Fit all markers"
    >
      <Maximize2 className="h-4 w-4 text-slate-700" />
    </button>
  );
}

export default function PropertyMap({ properties, onFavorite, savedPropertyIds, onBoundsChange }) {
  const validProperties = useMemo(() => 
    properties.filter(p => 
      p.latitude && p.longitude &&
      !isNaN(p.latitude) && !isNaN(p.longitude) &&
      p.latitude >= -90 && p.latitude <= 90 &&
      p.longitude >= -180 && p.longitude <= 180
    ), [properties]
  );

  const center = validProperties.length > 0 
    ? [validProperties[0].latitude, validProperties[0].longitude]
    : [33.3062, -111.8413]; // Queen Creek area

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="relative h-[70vh] min-h-[500px] rounded-xl overflow-hidden border border-slate-200 shadow-lg">
      <style>{`
        .custom-price-marker { background: transparent !important; border: none !important; }
        .leaflet-popup-content-wrapper { border-radius: 12px; padding: 0; overflow: hidden; }
        .leaflet-popup-content { margin: 0; width: 280px !important; }
        .leaflet-popup-tip { background: white; }
      `}</style>

      {validProperties.length === 0 ? (
        <div className="h-full flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <MapPin className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No properties with map coordinates found</p>
            <p className="text-slate-400 text-sm mt-1">Try adjusting your filters</p>
          </div>
        </div>
      ) : (
        <MapContainer
          center={center}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
          preferCanvas={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitBounds properties={validProperties} />
          <RefitButton properties={validProperties} />
          {onBoundsChange && <MapBoundsHandler onBoundsChange={onBoundsChange} />}

          {validProperties.map((property) => (
            <Marker
              key={property.id}
              position={[property.latitude, property.longitude]}
              icon={createPriceIcon(property.price)}
            >
              <Popup>
                <div className="w-[280px]">
                  {property.images?.[0] && (
                    <img
                      src={property.images[0]}
                      alt={property.address}
                      className="w-full h-40 object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="p-3">
                    <p className="text-lg font-bold text-slate-900">{formatPrice(property.price)}</p>
                    <p className="text-sm text-slate-600 mt-0.5 truncate">{property.address}</p>
                    <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                      <MapPin className="h-3 w-3" />
                      <span>{property.city}, {property.state} {property.zip_code}</span>
                    </div>
                    {property.cross_street && (
                      <p className="text-xs text-slate-400 mt-0.5">Near {property.cross_street}</p>
                    )}

                    <div className="flex gap-4 mt-2 text-sm text-slate-700">
                      <div className="flex items-center gap-1">
                        <Bed className="h-3.5 w-3.5 text-slate-400" />
                        <span>{property.bedrooms}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Bath className="h-3.5 w-3.5 text-slate-400" />
                        <span>{property.bathrooms}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Square className="h-3.5 w-3.5 text-slate-400" />
                        <span>{property.square_feet?.toLocaleString()}</span>
                      </div>
                    </div>

                    <Link to={createPageUrl('PropertyDetail') + `?id=${property.id}`}>
                      <Button className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-sm h-9">
                        View Details
                      </Button>
                    </Link>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}

      {validProperties.length > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 shadow border border-slate-200">
          {validProperties.length} {validProperties.length === 1 ? 'property' : 'properties'} on map
        </div>
      )}
    </div>
  );
}