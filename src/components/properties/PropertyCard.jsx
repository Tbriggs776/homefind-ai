import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bed, Bath, Square, MapPin, Heart, ChevronLeft, ChevronRight, TrendingDown, Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import LoginGateModal from '@/components/LoginGateModal';
import ShareButton from '@/components/properties/ShareButton';

export default function PropertyCard({ property, onFavorite, isFavorited, onCompare, isComparing, user }) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showLoginGate, setShowLoginGate] = useState(false);

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const images = property.images?.length > 0
    ? property.images
    : ['https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80'];

  const handlePrevImage = (e) => {
    e.preventDefault();
    if (!user) { setShowLoginGate(true); return; }
    setCurrentImageIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNextImage = (e) => {
    e.preventDefault();
    if (!user) { setShowLoginGate(true); return; }
    setCurrentImageIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {showLoginGate && <LoginGateModal onClose={() => setShowLoginGate(false)} />}
      <Card className={`overflow-hidden hover:shadow-xl transition-all duration-300 bg-white group ${isComparing ? 'ring-2 ring-slate-800' : 'border-slate-200'}`}>
        <Link to={createPageUrl('PropertyDetail') + `?id=${property.id}`}>
          <div className="relative h-56 overflow-hidden">
            <img
              src={images[currentImageIndex]}
              alt={property.address}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            />
            <div className="absolute top-3 left-3 flex gap-2">
              {property.status === 'active' && (
                <Badge className="bg-green-600 text-white border-0">Active</Badge>
              )}
              {property.status === 'coming_soon' && (
                <Badge className="bg-purple-600 text-white border-0">Coming Soon</Badge>
              )}
              {property.status === 'pending' && (
                <Badge className="bg-amber-600 text-white border-0">Pending</Badge>
              )}
              {property.is_featured && (
                <Badge className="bg-[#52ADEA] text-white border-0">Featured</Badge>
              )}
              {property.original_list_price && property.original_list_price > property.price && (
                <Badge className="bg-red-600 text-white border-0 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Price Reduced
                </Badge>
              )}
              {property.virtual_tour_url && (
                <Badge className="bg-indigo-600 text-white border-0 flex items-center gap-1">
                  <Video className="h-3 w-3" /> 3D Tour
                </Badge>
              )}
              {property.property_type === 'new_construction' && (
                <Badge className="bg-amber-600 text-white border-0">New Construction</Badge>
              )}
            </div>
            <div className="absolute top-3 right-3 flex gap-2">
              {onCompare && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    onCompare(property);
                  }}
                  className={`h-9 px-3 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-all text-xs font-medium ${
                    isComparing ? 'bg-slate-800 text-white' : 'bg-white/90 text-slate-600'
                  }`}
                >
                  {isComparing ? 'Selected' : 'Compare'}
                </button>
              )}
              <ShareButton property={property} variant="icon" />
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onFavorite?.(property);
                }}
                className="h-9 w-9 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-all"
              >
                <Heart
                  className={`h-4 w-4 transition-colors ${
                    isFavorited ? 'fill-red-500 text-red-500' : 'text-slate-600'
                  }`}
                />
              </button>
            </div>

            {images.length > 1 && (
              <>
                <button
                  onClick={handlePrevImage}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>
                <button
                  onClick={handleNextImage}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                >
                  <ChevronRight className="h-5 w-5 text-white" />
                </button>
                <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/50 backdrop-blur-sm rounded text-white text-xs">
                  {currentImageIndex + 1} / {images.length}
                </div>
              </>
            )}
          </div>
        </Link>

        <CardContent className="p-5">
          <Link to={createPageUrl('PropertyDetail') + `?id=${property.id}`}>
            <div className="mb-3">
              <div className="text-2xl font-bold text-slate-900 mb-1">
                {formatPrice(property.price)}
              </div>
              <div className="flex items-start gap-1 text-slate-600 text-sm">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{property.address}, {property.city}, {property.state}</span>
                {property._distance != null && (
                  <span className="ml-auto text-xs text-[#52ADEA] font-medium whitespace-nowrap">
                    {property._distance < 1 ? `${(property._distance * 5280).toFixed(0)} ft` : `${property._distance.toFixed(1)} mi`}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm text-slate-600 mb-4">
              {property.bedrooms > 0 && (
                <div className="flex items-center gap-1.5">
                  <Bed className="h-4 w-4" />
                  <span>{property.bedrooms} {property.bedrooms === 1 ? 'bed' : 'beds'}</span>
                </div>
              )}
              {property.bathrooms > 0 && (
                <div className="flex items-center gap-1.5">
                  <Bath className="h-4 w-4" />
                  <span>{property.bathrooms} {property.bathrooms === 1 ? 'bath' : 'baths'}</span>
                </div>
              )}
              {property.square_feet > 0 && (
                <div className="flex items-center gap-1.5">
                  <Square className="h-4 w-4" />
                  <span>{property.square_feet?.toLocaleString()} sqft</span>
                </div>
              )}
            </div>

            {property.features?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {property.features.slice(0, 3).map((feature, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs bg-slate-100 text-slate-700 border-0">
                    {feature}
                  </Badge>
                ))}
                {property.features.length > 3 && (
                  <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-700 border-0">
                    +{property.features.length - 3} more
                  </Badge>
                )}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              {property.listing_source === 'flexmls_idx' && (
                <img 
                  src="/armls-logo.png" 
                  alt="ARMLS" 
                  className="h-4 w-auto"
                />
              )}
              {property.list_office_name && (
                <p className="text-[10px] text-gray-500 font-medium">Listed by: {property.list_office_name}</p>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">All information should be verified by the recipient and none is guaranteed as accurate by ARMLS.</p>
          </Link>
        </CardContent>
      </Card>
    </motion.div>
  );
}