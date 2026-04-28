import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
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
      background: #00AFE5;
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

// Custom cluster icon — uses brand cyan instead of default green/yellow/red
function createClusterIcon(cluster) {
  const count = cluster.getChildCount();
  let size = 40;
  if (count >= 100) size = 56;
  else if (count >= 25) size = 48;

  return L.divIcon({
    className: 'custom-cluster-marker',
    html: `<div style="
      background: #00AFE5;
      color: white;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: ${count >= 100 ? '14px' : '13px'};
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    ">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
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

// Fits the map viewport to the property set on initial mount, then again
// whenever fitVersion increments. The parent (Search.jsx) bumps fitVersion
// when the user changes filters — without that signal, the map would stay
// zoomed on the previous city even though the property data has changed.
//
// We deliberately do NOT re-fit on every `properties` change, because with
// bounds-driven querying the property set updates on every pan/zoom, and
// re-fitting would yank the user's view back and forth.
function FitBounds({ properties, fitVersion = 0 }) {
  const map = useMap();
  const lastFitVersionRef = useRef(-1);

  useEffect(() => {
    if (properties.length === 0) return;
    if (lastFitVersionRef.current === fitVersion) return;
    const bounds = L.latLngBounds(properties.map(p => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    lastFitVersionRef.current = fitVersion;
  }, [properties, fitVersion, map]);

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
      className="absolute top-3 right-3 z-[1000] bg-white rounded-lg shadow-md p-2 hover:bg-muted border border-border"
      title="Fit all markers"
    >
      <Maximize2 className="h-4 w-4 text-foreground" />
    </button>
  );
}

export default function PropertyMap({ properties, mapProperties, onFavorite, savedPropertyIds, onBoundsChange, fitVersion = 0 }) {
  // Prefer the dedicated lite mapProperties when present (decoupled query),
  // fall back to the full properties array for backward compat
  const sourceProperties = mapProperties && mapProperties.length > 0 ? mapProperties : properties;

  const validProperties = useMemo(() =>
    sourceProperties.filter(p =>
      p.latitude && p.longitude &&
      !isNaN(p.latitude) && !isNaN(p.longitude) &&
      p.latitude >= -90 && p.latitude <= 90 &&
      p.longitude >= -180 && p.longitude <= 180
    ), [sourceProperties]
  );

  // Center + zoom defaults used only when the property set is empty AND on
  // very first render (FitBounds takes over once data loads). Centered on
  // Phoenix to give a sensible AZ-wide default per Crandell's service area.
  const center = validProperties.length > 0
    ? [validProperties[0].latitude, validProperties[0].longitude]
    : [33.4484, -112.0740]; // Phoenix, AZ

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="relative h-[70vh] min-h-[500px] rounded-xl overflow-hidden border border-border shadow-lg">
      <style>{`
        .custom-price-marker { background: transparent !important; border: none !important; }
        .custom-cluster-marker { background: transparent !important; border: none !important; }
        .leaflet-popup-content-wrapper { border-radius: 12px; padding: 0; overflow: hidden; }
        .leaflet-popup-content { margin: 0; width: 280px !important; }
        .leaflet-popup-tip { background: white; }
        .marker-cluster { background: transparent !important; }
        .marker-cluster div { background: transparent !important; }
      `}</style>

      {validProperties.length === 0 ? (
        <div className="h-full flex items-center justify-center bg-muted">
          <div className="text-center">
            <MapPin className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No properties with map coordinates found</p>
            <p className="text-muted-foreground/70 text-sm mt-1">Try adjusting your filters</p>
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

          <FitBounds properties={validProperties} fitVersion={fitVersion} />
          <RefitButton properties={validProperties} />
          {onBoundsChange && <MapBoundsHandler onBoundsChange={onBoundsChange} />}

          {/* MarkerClusterGroup wraps all individual markers — pins cluster
              when zoomed out, expand to individual pins when zoomed in.
              chunkedLoading prevents UI freeze when rendering 500+ pins. */}
          <MarkerClusterGroup
            chunkedLoading
            iconCreateFunction={createClusterIcon}
            showCoverageOnHover={false}
            spiderfyOnMaxZoom={true}
            maxClusterRadius={60}
          >
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
                      <p className="text-lg font-bold text-foreground">{formatPrice(property.price)}</p>
                      <p className="text-sm text-muted-foreground mt-0.5 truncate">{property.address}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <MapPin className="h-3 w-3" />
                        <span>{property.city}, {property.state} {property.zip_code}</span>
                      </div>
                      {property.cross_street && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">Near {property.cross_street}</p>
                      )}

                      <div className="flex gap-4 mt-2 text-sm text-foreground">
                        <div className="flex items-center gap-1">
                          <Bed className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{property.bedrooms}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Bath className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{property.bathrooms}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Square className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{property.square_feet?.toLocaleString()}</span>
                        </div>
                      </div>

                      <Link to={createPageUrl('PropertyDetail') + `?id=${property.id}`}>
                        <Button className="w-full mt-3 bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground text-sm h-9">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      )}

      {validProperties.length > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-medium text-foreground shadow border border-border">
          {validProperties.length.toLocaleString()} {validProperties.length === 1 ? 'property' : 'properties'} on map
        </div>
      )}
    </div>
  );
}
