import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Heart, Share2, Bed, Bath, Square, MapPin,
  Calendar, Home as HomeIcon, Loader2, ChevronLeft, ChevronRight, X, Expand,
  TrendingDown, Video, DollarSign, GraduationCap, Mountain, Eye
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import AIAssistant from '../components/ai/AIAssistant';
import LoginGateModal from '../components/LoginGateModal';
import ShareButton from '../components/properties/ShareButton';

export default function PropertyDetail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isSaved, setIsSaved] = useState(false);
  const [viewStartTime] = useState(Date.now());
  const [imagesViewed, setImagesViewed] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const [showLoginGate, setShowLoginGate] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const propertyId = urlParams.get('id');

  // Fetch property from database
  const { data: property, isLoading } = useQuery({
    queryKey: ['property', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!propertyId
  });

  // Check if saved
  useEffect(() => {
    if (user && propertyId) {
      supabase
        .from('saved_properties')
        .select('id')
        .eq('user_id', user.id)
        .eq('property_id', propertyId)
        .then(({ data }) => setIsSaved(data && data.length > 0));
    }
  }, [user, propertyId]);

  // Track view on mount and unmount
  useEffect(() => {
    if (!user || !propertyId) return;

    supabase.from('property_views').insert({
      property_id: propertyId,
      user_id: user.id,
      interaction_type: 'view',
      duration_seconds: 0,
      viewed_images: 0
    });

    return () => {
      const duration = Math.floor((Date.now() - viewStartTime) / 1000);
      supabase.from('property_views').insert({
        property_id: propertyId,
        user_id: user.id,
        interaction_type: 'view',
        duration_seconds: duration,
        viewed_images: imagesViewed
      });
    };
  }, [user, propertyId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: existing } = await supabase
        .from('saved_properties')
        .select('id')
        .eq('user_id', user.id)
        .eq('property_id', propertyId);

      if (existing && existing.length > 0) {
        await supabase.from('saved_properties').delete().eq('id', existing[0].id);
        return 'removed';
      } else {
        await supabase.from('saved_properties').insert({
          user_id: user.id,
          property_id: propertyId
        });
        await supabase.from('property_views').insert({
          property_id: propertyId,
          user_id: user.id,
          interaction_type: 'favorite'
        });
        return 'added';
      }
    },
    onMutate: async () => { setIsSaved(prev => !prev); },
    onError: () => { setIsSaved(prev => !prev); },
    onSuccess: (action) => { setIsSaved(action === 'added'); }
  });

  const images = property?.images?.length > 0
    ? property.images
    : ['https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80'];

  const handleImageChange = (index) => {
    setCurrentImageIndex(index);
    setImagesViewed(prev => Math.max(prev, index + 1));
  };

  const handlePrevImage = () => {
    if (!user) { setShowLoginGate(true); return; }
    const newIndex = currentImageIndex === 0 ? images.length - 1 : currentImageIndex - 1;
    handleImageChange(newIndex);
  };

  const handleNextImage = () => {
    if (!user) { setShowLoginGate(true); return; }
    const newIndex = currentImageIndex === images.length - 1 ? 0 : currentImageIndex + 1;
    handleImageChange(newIndex);
  };

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') handlePrevImage();
      else if (e.key === 'ArrowRight') handleNextImage();
      else if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, currentImageIndex, images.length]);

  const handleTouchStart = (e) => setTouchStart(e.targetTouches[0].clientX);
  const handleTouchMove = (e) => setTouchEnd(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50) handleNextImage();
    else if (distance < -50) handlePrevImage();
    setTouchStart(0);
    setTouchEnd(0);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="crandell-container py-20 text-center">
        <p className="text-slate-600 text-lg">Property not found.</p>
        <Link to={createPageUrl('Search')}>
          <Button className="mt-4 bg-slate-800 hover:bg-slate-700">Back to Search</Button>
        </Link>
      </div>
    );
  }

  const formatPrice = (price) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price);

  return (
    <div className="min-h-screen pb-12">
      {showLoginGate && <LoginGateModal onClose={() => setShowLoginGate(false)} />}
      <div className="bg-white border-b border-slate-200">
        <div className="crandell-container py-4">
          <Link to={createPageUrl('Search')}>
            <Button variant="ghost" className="text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Search
            </Button>
          </Link>
        </div>
      </div>

      <div className="crandell-container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Image Gallery */}
            <Card className="overflow-hidden shadow-lg border-slate-200">
              <div className="relative h-96 bg-slate-100 group">
                <img src={images[currentImageIndex]} alt={property.address} className="w-full h-full object-cover" />
                {images.length > 1 && (
                  <>
                    <button onClick={handlePrevImage} className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center"><ChevronLeft className="h-6 w-6 text-white" /></button>
                    <button onClick={handleNextImage} className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center"><ChevronRight className="h-6 w-6 text-white" /></button>
                  </>
                )}
                <button onClick={() => user ? setIsFullscreen(true) : setShowLoginGate(true)} className="absolute top-4 right-4 h-10 w-10 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center"><Expand className="h-5 w-5 text-white" /></button>
                {images.length > 1 && (
                  <>
                    <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/50 backdrop-blur-sm rounded-full text-white text-sm font-medium">{currentImageIndex + 1} / {images.length}</div>
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
                      {images.map((_, idx) => (
                        <button key={idx} onClick={() => handleImageChange(idx)} className={`h-2 rounded-full transition-all ${idx === currentImageIndex ? 'w-8 bg-white' : 'w-2 bg-white/50 hover:bg-white/75'}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* Property Info */}
            <Card className="shadow-lg border-slate-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h1 className="text-3xl font-bold text-slate-900">{formatPrice(property.price)}</h1>
                      {property.original_list_price && property.original_list_price > property.price && (
                        <div className="flex items-center gap-1">
                          <TrendingDown className="h-4 w-4 text-red-600" />
                          <span className="text-sm text-red-600 line-through">{formatPrice(property.original_list_price)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <MapPin className="h-5 w-5" />
                      <span className="text-lg">{property.address}, {property.city}, {property.state} {property.zip_code}</span>
                    </div>
                    {property.subdivision && <p className="text-sm text-slate-500 mt-1 ml-7">{property.subdivision}</p>}
                  </div>
                  <div className="flex gap-2">
                    {property && <ShareButton property={property} variant="button" />}
                    <Button variant="outline" size="icon" onClick={() => user ? saveMutation.mutate() : navigate('/Login')} className={isSaved ? 'border-red-500' : ''}>
                      <Heart className={`h-5 w-5 ${isSaved ? 'fill-red-500 text-red-500' : 'text-slate-600'}`} />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6 border-y border-slate-200">
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Bed className="h-5 w-5 text-slate-600" /><span className="text-2xl font-bold text-slate-900">{property.bedrooms}</span></div><p className="text-sm text-slate-600">Bedrooms</p></div>
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Bath className="h-5 w-5 text-slate-600" /><span className="text-2xl font-bold text-slate-900">{property.bathrooms}</span></div><p className="text-sm text-slate-600">Bathrooms</p></div>
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Square className="h-5 w-5 text-slate-600" /><span className="text-2xl font-bold text-slate-900">{property.square_feet?.toLocaleString()}</span></div><p className="text-sm text-slate-600">Sq Ft</p></div>
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Calendar className="h-5 w-5 text-slate-600" /><span className="text-2xl font-bold text-slate-900">{property.year_built}</span></div><p className="text-sm text-slate-600">Year Built</p></div>
                </div>

                <div className="mt-6">
                  <h2 className="text-xl font-bold text-slate-900 mb-3">Description</h2>
                  <p className="text-slate-700 leading-relaxed">{property.description || 'No description available.'}</p>
                </div>

                {property.virtual_tour_url && (
                  <div className="mt-6">
                    <a href={property.virtual_tour_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-3 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-medium">
                      <Video className="h-5 w-5" /> View 3D Virtual Tour
                    </a>
                  </div>
                )}

                {property.features?.length > 0 && (
                  <div className="mt-6">
                    <h2 className="text-xl font-bold text-slate-900 mb-3">Features</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {property.features.map((feature, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-slate-700"><div className="h-1.5 w-1.5 bg-amber-600 rounded-full" /><span>{feature}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {(property.tax_annual_amount || property.hoa_fee) && (
                  <div className="mt-6">
                    <h2 className="text-xl font-bold text-slate-900 mb-3 flex items-center gap-2"><DollarSign className="h-5 w-5" /> Financial Details</h2>
                    <div className="grid grid-cols-2 gap-4">
                      {property.tax_annual_amount > 0 && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <p className="text-xs text-slate-500 mb-1">Annual Property Tax</p>
                          <p className="font-semibold text-slate-900">{formatPrice(property.tax_annual_amount)}/yr</p>
                          <p className="text-xs text-slate-400">{formatPrice(Math.round(property.tax_annual_amount / 12))}/mo</p>
                        </div>
                      )}
                      {property.hoa_fee > 0 && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <p className="text-xs text-slate-500 mb-1">HOA Fee</p>
                          <p className="font-semibold text-slate-900">{formatPrice(property.hoa_fee)}{property.hoa_fee_frequency ? `/${property.hoa_fee_frequency.toLowerCase().replace('ly','')}` : ''}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(property.elementary_school || property.middle_school || property.high_school) && (
                  <div className="mt-6">
                    <h2 className="text-xl font-bold text-slate-900 mb-3 flex items-center gap-2"><GraduationCap className="h-5 w-5" /> Schools</h2>
                    <div className="space-y-2">
                      {property.elementary_school && <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Elementary</span><span className="font-medium text-slate-800">{property.elementary_school}</span></div>}
                      {property.middle_school && <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Middle</span><span className="font-medium text-slate-800">{property.middle_school}</span></div>}
                      {property.high_school && <div className="flex items-center justify-between text-sm"><span className="text-slate-500">High School</span><span className="font-medium text-slate-800">{property.high_school}</span></div>}
                    </div>
                  </div>
                )}

                {property.has_view && property.view_description && (
                  <div className="mt-6">
                    <h2 className="text-xl font-bold text-slate-900 mb-2 flex items-center gap-2"><Eye className="h-5 w-5" /> View</h2>
                    <p className="text-slate-700">{property.view_description}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg border-slate-200 sticky top-24">
              <CardContent className="p-6 space-y-4">
                <div><p className="text-sm text-slate-600 mb-1">Property Type</p><Badge className="bg-slate-100 text-slate-800 border-0">{property.property_type?.replace(/_/g, ' ')}</Badge></div>
                {property.lot_size > 0 && <div><p className="text-sm text-slate-600 mb-1">Lot Size</p><p className="font-semibold text-slate-900">{property.lot_size} acres</p></div>}
                {property.days_on_market > 0 && <div><p className="text-sm text-slate-600 mb-1">Days on Market</p><p className="font-semibold text-slate-900">{property.days_on_market} days</p></div>}
                {property.mls_number && <div><p className="text-sm text-slate-600 mb-1">MLS Number</p><p className="font-semibold text-slate-900">{property.mls_number}</p></div>}
                {property.county && <div><p className="text-sm text-slate-600 mb-1">County</p><p className="font-semibold text-slate-900">{property.county}</p></div>}
                {(property.list_office_name || property.listing_office_name) && <div><p className="text-sm text-slate-600 mb-1">Listing Firm</p><p className="font-semibold text-slate-900 text-sm">{property.list_office_name || property.listing_office_name}</p></div>}

                {/* ARMLS Rule 23.2.12: Display listing agent email or phone */}
                {(property.listing_agent_name || property.listing_agent_email || property.listing_agent_phone) && (
                  <div className="pt-3 border-t border-slate-100">
                    <p className="text-sm text-slate-600 mb-1">Listing Agent</p>
                    {property.listing_agent_name && <p className="font-semibold text-slate-900 text-sm">{property.listing_agent_name}</p>}
                    {property.listing_agent_email && <p className="text-xs text-slate-500">{property.listing_agent_email}</p>}
                    {property.listing_agent_phone && <p className="text-xs text-slate-500">{property.listing_agent_phone}</p>}
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200">
                  {property.listing_source === 'flexmls_idx' ? (
                    <div className="flex items-center justify-center bg-slate-50 rounded-lg p-3">
                      <img src="/armls-logo.png" alt="ARMLS" className="h-8 object-contain" />
                    </div>
                  ) : (
                    <><p className="text-xs text-slate-500">Listing Source</p><Badge variant="outline" className="mt-1">{property.listing_source?.replace(/_/g, ' ')}</Badge></>
                  )}
                </div>

                <Button
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white"
                  onClick={async () => {
                    if (!user) { navigate('/Login'); return; }
                    try {
                      const response = await invokeFunction('contactAgentForProperty', {
                        property: { id: property.id, address: property.address, city: property.city, state: property.state, zip_code: property.zip_code, price: property.price, bedrooms: property.bedrooms, bathrooms: property.bathrooms, square_feet: property.square_feet, mls_number: property.mls_number }
                      });
                      if (response.success) { setIsSaved(true); alert(response.message); }
                    } catch { alert('Failed to contact agent. Please try again.'); }
                  }}
                >
                  Contact Agent
                </Button>
                <div className="mt-4 pt-3 border-t border-slate-100">
                  {(property.list_office_name || property.listing_office_name) && <p className="text-xs text-slate-600 font-medium text-center mb-1">Listing courtesy of {property.list_office_name || property.listing_office_name}</p>}
                  <p className="text-[10px] text-gray-400 text-center">All information should be verified by the recipient and none is guaranteed as accurate by ARMLS.</p>
                  <p className="text-[10px] text-gray-400 text-center mt-1">Information source: ARMLS.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {user && property && (
        <AIAssistant user={user} contextData={{ currentProperty: { address: property.address, price: property.price, bedrooms: property.bedrooms, bathrooms: property.bathrooms } }} />
      )}

      {/* Fullscreen Image Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
          <button onClick={() => setIsFullscreen(false)} className="absolute top-4 right-4 h-12 w-12 bg-black/90 hover:bg-black backdrop-blur-sm rounded-full flex items-center justify-center z-10"><X className="h-6 w-6 text-white" /></button>
          <div className="relative w-full h-full flex items-center justify-center p-4" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            <img src={images[currentImageIndex]} alt={property.address} className="w-full h-full object-contain" />
            {images.length > 1 && (
              <>
                <button onClick={handlePrevImage} className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><ChevronLeft className="h-7 w-7 text-white" /></button>
                <button onClick={handleNextImage} className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center"><ChevronRight className="h-7 w-7 text-white" /></button>
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-white font-medium">{currentImageIndex + 1} / {images.length}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
