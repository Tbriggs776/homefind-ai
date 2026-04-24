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
  TrendingDown, Video, DollarSign, GraduationCap, Mountain, Eye,
  Phone, MessageCircle, CalendarCheck
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import AIAssistant from '../components/ai/AIAssistant';
import LoginGateModal from '../components/LoginGateModal';
import ShareButton from '../components/properties/ShareButton';
import PropertyCard from '../components/properties/PropertyCard';
import PropertyDetailSkeleton from '../components/properties/PropertyDetailSkeleton';

// ============================================================================
// MORTGAGE PAYMENT CALCULATION
// ----------------------------------------------------------------------------
// Standard amortization formula:  M = P × [r(1+r)^n] / [(1+r)^n - 1]
// Where P = principal, r = monthly rate, n = number of payments.
// Returns monthly P&I (principal + interest) only — taxes, HOA, insurance
// are added separately by the calling component.
// ============================================================================
function calculateMonthlyPI(homePrice, downPaymentPct, ratePct, termYears) {
  const principal = homePrice * (1 - downPaymentPct / 100);
  const monthlyRate = (ratePct / 100) / 12;
  const numPayments = termYears * 12;

  // Edge case: 0% interest → simple division
  if (monthlyRate === 0) return principal / numPayments;

  const factor = Math.pow(1 + monthlyRate, numPayments);
  return (principal * monthlyRate * factor) / (factor - 1);
}

// Normalize HOA fee to a monthly amount based on the frequency string
function normalizeHoaToMonthly(fee, frequency) {
  if (!fee || fee <= 0) return 0;
  const freq = (frequency || '').toLowerCase();
  if (freq.includes('annual') || freq.includes('year')) return fee / 12;
  if (freq.includes('quarter')) return fee / 3;
  if (freq.includes('semi')) return fee / 6;
  return fee;  // assume monthly if unspecified
}

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
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactSuccess, setContactSuccess] = useState(false);

  // Mortgage calculator state — defaults match the conventional buyer profile
  // (20% down, 30-year fixed, 6.5% rate). Buyers can adjust each value via the
  // sliders/buttons in the calculator card on the right sidebar.
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [loanTermYears, setLoanTermYears] = useState(30);
  const [interestRate, setInterestRate] = useState(6.5);

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

  // ============================================================================
  // SIMILAR HOMES QUERY
  // ----------------------------------------------------------------------------
  // Fetches up to 6 properties matching the four things buyers actually
  // compare on: same city, ±20% price, ±1 bedroom, has valid coordinates.
  // Excludes the current property and only returns active/coming_soon
  // listings. Cached by property ID so navigating between properties refetches
  // automatically.
  // ============================================================================
  const { data: similarHomes = [] } = useQuery({
    queryKey: ['similarHomes', propertyId, property?.city, property?.price, property?.bedrooms],
    queryFn: async () => {
      if (!property || !property.city || !property.price) return [];

      const minPrice = property.price * 0.8;
      const maxPrice = property.price * 1.2;
      const minBeds = Math.max(0, (property.bedrooms || 0) - 1);
      const maxBeds = (property.bedrooms || 0) + 1;

      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .neq('id', property.id)
        .ilike('city', property.city)
        .gte('price', minPrice)
        .lte('price', maxPrice)
        .gte('bedrooms', minBeds)
        .lte('bedrooms', maxBeds)
        .in('status', ['active', 'coming_soon'])
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) {
        console.error('Similar homes query failed:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!property?.city && !!property?.price,
    staleTime: 60000  // cache for 1 minute — same property page revisits within a minute reuse the cached result
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
    }).then(({ error }) => {
      if (error) console.error('[tracking] property_views insert (mount) failed:', error);
    });

    return () => {
      const duration = Math.floor((Date.now() - viewStartTime) / 1000);
      supabase.from('property_views').insert({
        property_id: propertyId,
        user_id: user.id,
        interaction_type: 'view',
        duration_seconds: duration,
        viewed_images: imagesViewed
      }).then(({ error }) => {
        if (error) console.error('[tracking] property_views insert (unmount) failed:', error);
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

  // ============================================================================
  // CRANDELL CONTACT HANDLER
  // ----------------------------------------------------------------------------
  // This calls the existing contactAgentForProperty edge function (which we
  // trust is wired to FUB and routes leads to Tanner Crandell, NOT to the
  // listing brokerage). The frontend now makes it explicit the buyer is
  // contacting Tanner — not the eXp Realty / HomeSmart / etc. listing agent
  // shown in the legally-required ARMLS attribution.
  // ============================================================================
  const handleCrandellContact = async (intent) => {
    if (!user) {
      navigate('/Login');
      return;
    }
    setContactSubmitting(true);
    try {
      const response = await invokeFunction('contactAgentForProperty', {
        property: {
          id: property.id,
          address: property.address,
          city: property.city,
          state: property.state,
          zip_code: property.zip_code,
          price: property.price,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          square_feet: property.square_feet,
          mls_number: property.mls_number
        },
        intent  // 'tour' or 'question' — backend can route accordingly
      });
      if (response.success) {
        setContactSuccess(true);
        setTimeout(() => setContactSuccess(false), 5000);
      }
    } catch {
      alert('Sorry — we couldn\'t send your request. Please try again or call directly.');
    } finally {
      setContactSubmitting(false);
    }
  };

  if (isLoading) {
    return <PropertyDetailSkeleton />;
  }

  if (!property) {
    return (
      <div className="crandell-container py-20 text-center">
        <p className="text-muted-foreground text-lg">Property not found.</p>
        <Link to={createPageUrl('Search')}>
          <Button className="mt-4 bg-secondary hover:bg-[var(--crandell-charcoal-hover)]">Back to Search</Button>
        </Link>
      </div>
    );
  }

  const formatPrice = (price) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price);

  return (
    <div className="min-h-screen pb-12 bg-background">
      {showLoginGate && <LoginGateModal onClose={() => setShowLoginGate(false)} />}

      {/* Back to search bar */}
      <div className="bg-white border-b border-border">
        <div className="crandell-container py-4">
          <Link to={createPageUrl('Search')}>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Search
            </Button>
          </Link>
        </div>
      </div>

      <div className="crandell-container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">

            {/* ================================================================
                IMAGE GALLERY
                ----------------------------------------------------------------
                Bumped from h-96 (384px) to h-[600px] on desktop so the photo
                actually gets the visual weight a $XXX,000 listing deserves.
                Mobile keeps the smaller height for vertical space efficiency.
                ================================================================ */}
            <Card className="overflow-hidden shadow-lg border-border">
              <div
                className="relative aspect-[4/3] bg-muted group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                role={images.length > 1 ? 'region' : undefined}
                aria-roledescription={images.length > 1 ? 'carousel' : undefined}
                aria-label={images.length > 1 ? 'Property image gallery' : undefined}
                tabIndex={images.length > 1 ? 0 : undefined}
                onKeyDown={(e) => {
                  if (images.length <= 1) return;
                  if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrevImage(); }
                  else if (e.key === 'ArrowRight') { e.preventDefault(); handleNextImage(); }
                }}
              >
                <img
                  src={images[currentImageIndex]}
                  alt={images.length > 1 ? `${property.address}, image ${currentImageIndex + 1} of ${images.length}` : property.address}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
                {images.length > 1 && (
                  <>
                    <button type="button" onClick={handlePrevImage} aria-label="Previous image" className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronLeft className="h-6 w-6 text-white" aria-hidden="true" /></button>
                    <button type="button" onClick={handleNextImage} aria-label="Next image" className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronRight className="h-6 w-6 text-white" aria-hidden="true" /></button>
                  </>
                )}
                <button type="button" onClick={() => user ? setIsFullscreen(true) : setShowLoginGate(true)} aria-label="View image fullscreen" className="absolute top-4 right-4 h-10 w-10 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Expand className="h-5 w-5 text-white" aria-hidden="true" /></button>
                {images.length > 1 && (
                  <>
                    <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/50 backdrop-blur-sm rounded-full text-white text-sm font-medium" aria-live="polite" aria-atomic="true"><span className="sr-only">Image </span>{currentImageIndex + 1} / {images.length}</div>
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2" role="tablist" aria-label="Choose image">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleImageChange(idx)}
                          role="tab"
                          aria-selected={idx === currentImageIndex}
                          aria-label={`Go to image ${idx + 1}`}
                          className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${idx === currentImageIndex ? 'w-8 bg-white' : 'w-2 bg-white/50 hover:bg-white/75'}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* Property Info */}
            <Card className="shadow-lg border-border">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h1 className="text-3xl font-normal text-foreground">{formatPrice(property.price)}</h1>
                      {property.original_list_price && property.original_list_price > property.price && (
                        <div className="flex items-center gap-1">
                          <TrendingDown className="h-4 w-4 text-red-600" />
                          <span className="text-sm text-red-600 line-through">{formatPrice(property.original_list_price)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-5 w-5" />
                      <span className="text-lg">{property.address}, {property.city}, {property.state} {property.zip_code}</span>
                    </div>
                    {property.subdivision && (
                      <Link
                        to={`${createPageUrl('Search')}?subdivision=${encodeURIComponent(property.subdivision)}`}
                        className="inline-block text-sm text-primary hover:text-[var(--crandell-primary-hover)] hover:underline mt-1 ml-7 font-medium"
                      >
                        {property.subdivision} →
                      </Link>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {property && <ShareButton property={property} variant="button" />}
                    <Button variant="outline" size="icon" onClick={() => user ? saveMutation.mutate() : navigate('/Login')} className={isSaved ? 'border-red-500' : ''}>
                      <Heart className={`h-5 w-5 ${isSaved ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6 border-y border-border">
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Bed className="h-5 w-5 text-muted-foreground" /><span className="text-2xl font-bold text-foreground">{property.bedrooms}</span></div><p className="text-sm text-muted-foreground">Bedrooms</p></div>
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Bath className="h-5 w-5 text-muted-foreground" /><span className="text-2xl font-bold text-foreground">{property.bathrooms}</span></div><p className="text-sm text-muted-foreground">Bathrooms</p></div>
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Square className="h-5 w-5 text-muted-foreground" /><span className="text-2xl font-bold text-foreground">{property.square_feet?.toLocaleString()}</span></div><p className="text-sm text-muted-foreground">Sq Ft</p></div>
                  <div className="text-center"><div className="flex items-center justify-center gap-2 mb-1"><Calendar className="h-5 w-5 text-muted-foreground" /><span className="text-2xl font-bold text-foreground">{property.year_built}</span></div><p className="text-sm text-muted-foreground">Year Built</p></div>
                </div>

                <div className="mt-6">
                  <h2 className="text-xl font-semibold text-foreground mb-3">Description</h2>
                  <p className="text-foreground/80 leading-relaxed">{property.description || 'No description available.'}</p>
                </div>

                {property.virtual_tour_url && (
                  <div className="mt-6">
                    <a href={property.virtual_tour_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-3 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors font-medium">
                      <Video className="h-5 w-5" /> View 3D Virtual Tour
                    </a>
                  </div>
                )}

                {property.features?.length > 0 && (
                  <div className="mt-6">
                    <h2 className="text-xl font-semibold text-foreground mb-3">Features</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {property.features.map((feature, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-foreground/80"><div className="h-1.5 w-1.5 bg-primary rounded-full" /><span>{feature}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {(property.tax_annual_amount || property.hoa_fee) && (
                  <div className="mt-6">
                    <h2 className="text-xl font-semibold text-foreground mb-3 flex items-center gap-2"><DollarSign className="h-5 w-5" /> Financial Details</h2>
                    <div className="grid grid-cols-2 gap-4">
                      {property.tax_annual_amount > 0 && (
                        <div className="bg-muted rounded-lg p-3">
                          <p className="text-xs text-muted-foreground mb-1">Annual Property Tax</p>
                          <p className="font-semibold text-foreground">{formatPrice(property.tax_annual_amount)}/yr</p>
                          <p className="text-xs text-muted-foreground">{formatPrice(Math.round(property.tax_annual_amount / 12))}/mo</p>
                        </div>
                      )}
                      {property.hoa_fee > 0 && (
                        <div className="bg-muted rounded-lg p-3">
                          <p className="text-xs text-muted-foreground mb-1">HOA Fee</p>
                          <p className="font-semibold text-foreground">{formatPrice(property.hoa_fee)}{property.hoa_fee_frequency ? `/${property.hoa_fee_frequency.toLowerCase().replace('ly','')}` : ''}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(property.elementary_school || property.middle_school || property.high_school) && (
                  <div className="mt-6">
                    <h2 className="text-xl font-semibold text-foreground mb-3 flex items-center gap-2"><GraduationCap className="h-5 w-5" /> Schools</h2>
                    <div className="space-y-2">
                      {property.elementary_school && <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Elementary</span><span className="font-medium text-foreground">{property.elementary_school}</span></div>}
                      {property.middle_school && <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Middle</span><span className="font-medium text-foreground">{property.middle_school}</span></div>}
                      {property.high_school && <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">High School</span><span className="font-medium text-foreground">{property.high_school}</span></div>}
                    </div>
                  </div>
                )}

                {property.has_view && property.view_description && (
                  <div className="mt-6">
                    <h2 className="text-xl font-semibold text-foreground mb-2 flex items-center gap-2"><Eye className="h-5 w-5" /> View</h2>
                    <p className="text-foreground/80">{property.view_description}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ====================================================================
              SIDEBAR
              --------------------------------------------------------------------
              Order matters. From top to bottom:
                1. CRANDELL CONTACT MODULE — primary CTA, brand-bordered, gets
                   all the visual weight. This is what the buyer should click.
                2. Property metadata (lot, MLS, county, listing firm)
                3. ARMLS attribution + listing agent info — legally required,
                   visually demoted to a footer-style block.
              ==================================================================== */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">

              {/* CRANDELL CONTACT MODULE — the primary CTA */}
              <Card className="border-2 border-primary shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <img
                      src="/team/tanner.jpg"
                      alt="Tanner Crandell"
                      loading="lazy"
                      decoding="async"
                      className="w-14 h-14 rounded-full object-cover bg-muted shadow-sm"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <div>
                      <p className="font-semibold text-foreground">Tanner Crandell</p>
                      <p className="text-xs text-muted-foreground">Crandell Real Estate Team · Balboa Realty</p>
                    </div>
                  </div>

                  <p className="text-sm text-foreground/80 mb-4 leading-relaxed">
                    Interested in this {property.bedrooms}-bedroom in {property.city}? I can show
                    you this home, pull comps, or answer questions about the neighborhood.
                  </p>

                  {contactSuccess ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                      ✓ Got it. Tanner will reach out shortly.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        className="w-full bg-primary hover:bg-[var(--crandell-primary-hover)] text-primary-foreground font-semibold"
                        disabled={contactSubmitting}
                        onClick={() => handleCrandellContact('tour')}
                      >
                        {contactSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <CalendarCheck className="h-4 w-4 mr-2" />
                        )}
                        Schedule a Tour
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground"
                        disabled={contactSubmitting}
                        onClick={() => handleCrandellContact('question')}
                      >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Ask a Question
                      </Button>
                    </div>
                  )}

                  <a
                    href="tel:+14805441539"
                    className="block text-center text-sm text-muted-foreground hover:text-primary py-3 mt-2 transition-colors"
                  >
                    <Phone className="h-3 w-3 inline mr-1" />
                    Or call (480) 544-1539
                  </a>
                </CardContent>
              </Card>

              {/* Property metadata */}
              <Card className="shadow-md border-border">
                <CardContent className="p-6 space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Property Type</p>
                    <Badge className="bg-muted text-foreground border-0">{property.property_type?.replace(/_/g, ' ')}</Badge>
                  </div>
                  {property.lot_size > 0 && <div><p className="text-sm text-muted-foreground mb-1">Lot Size</p><p className="font-semibold text-foreground">{property.lot_size} acres</p></div>}
                  {property.days_on_market > 0 && <div><p className="text-sm text-muted-foreground mb-1">Days on Market</p><p className="font-semibold text-foreground">{property.days_on_market} days</p></div>}
                  {property.mls_number && <div><p className="text-sm text-muted-foreground mb-1">MLS Number</p><p className="font-semibold text-foreground">{property.mls_number}</p></div>}
                  {property.county && <div><p className="text-sm text-muted-foreground mb-1">County</p><p className="font-semibold text-foreground">{property.county}</p></div>}
                </CardContent>
              </Card>

              {/* ================================================================
                  MORTGAGE CALCULATOR
                  ----------------------------------------------------------------
                  Buyers want to know "what would this cost me per month" before
                  they ask for a tour. Defaults match Zillow's conventional buyer
                  profile (20% down, 30yr, 6.5%). Sliders + button group let
                  buyers adjust each input. Total monthly payment is the loudest
                  visual element.
                  ================================================================ */}
              {(() => {
                const monthlyPI = calculateMonthlyPI(property.price, downPaymentPct, interestRate, loanTermYears);
                const monthlyTax = property.tax_annual_amount > 0
                  ? property.tax_annual_amount / 12
                  : (property.price * 0.0065) / 12;  // estimate at Maricopa County average
                const monthlyHoa = normalizeHoaToMonthly(property.hoa_fee, property.hoa_fee_frequency);
                const monthlyInsurance = (property.price * 0.005) / 12;  // industry rule of thumb for AZ
                const totalMonthly = monthlyPI + monthlyTax + monthlyHoa + monthlyInsurance;
                const downPaymentAmount = property.price * (downPaymentPct / 100);

                return (
                  <Card className="shadow-md border-border">
                    <CardContent className="p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <DollarSign className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-foreground">Monthly Payment</h3>
                      </div>

                      {/* Total monthly — the loudest visual element */}
                      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-5">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Estimated total</p>
                        <p className="text-3xl font-bold text-foreground">
                          {formatPrice(Math.round(totalMonthly))}
                          <span className="text-base font-normal text-muted-foreground">/mo</span>
                        </p>
                      </div>

                      {/* Down payment slider */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs text-muted-foreground font-medium">Down payment</label>
                          <span className="text-xs font-semibold text-foreground">
                            {downPaymentPct}% ({formatPrice(Math.round(downPaymentAmount))})
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="50"
                          step="1"
                          value={downPaymentPct}
                          onChange={(e) => setDownPaymentPct(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>

                      {/* Loan term button group */}
                      <div className="mb-4">
                        <label className="text-xs text-muted-foreground font-medium block mb-2">Loan term</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[15, 20, 30].map((years) => (
                            <button
                              key={years}
                              onClick={() => setLoanTermYears(years)}
                              className={`py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
                                loanTermYears === years
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-white text-foreground border-border hover:border-primary'
                              }`}
                            >
                              {years} yr
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Interest rate slider */}
                      <div className="mb-5">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs text-muted-foreground font-medium">Interest rate</label>
                          <span className="text-xs font-semibold text-foreground">{interestRate.toFixed(3)}%</span>
                        </div>
                        <input
                          type="range"
                          min="3"
                          max="9"
                          step="0.125"
                          value={interestRate}
                          onChange={(e) => setInterestRate(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>

                      {/* Breakdown */}
                      <div className="space-y-1.5 pt-4 border-t border-border text-sm">
                        <div className="flex justify-between text-foreground/80">
                          <span>Principal &amp; interest</span>
                          <span className="font-medium">{formatPrice(Math.round(monthlyPI))}</span>
                        </div>
                        <div className="flex justify-between text-foreground/80">
                          <span>
                            Property tax
                            {!(property.tax_annual_amount > 0) && <span className="text-muted-foreground/60 text-xs ml-1">(est.)</span>}
                          </span>
                          <span className="font-medium">{formatPrice(Math.round(monthlyTax))}</span>
                        </div>
                        {monthlyHoa > 0 && (
                          <div className="flex justify-between text-foreground/80">
                            <span>HOA</span>
                            <span className="font-medium">{formatPrice(Math.round(monthlyHoa))}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-foreground/80">
                          <span>Home insurance <span className="text-muted-foreground/60 text-xs">(est.)</span></span>
                          <span className="font-medium">{formatPrice(Math.round(monthlyInsurance))}</span>
                        </div>
                      </div>

                      <p className="text-[10px] text-muted-foreground/60 mt-3 italic">
                        Estimate only. Doesn't include PMI (typically required if down payment is below 20%). Talk to Tanner for a real quote.
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* ARMLS attribution — legally required, visually demoted to footer-style block.
                  This satisfies ARMLS Rule 23.2.12 (display listing agent contact info)
                  while making it clear this is NOT the primary action on the page. */}
              <div className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground space-y-2">
                {property.listing_source === 'flexmls_idx' && (
                  <div className="flex items-center justify-center pb-2 border-b border-border">
                    <img src="/armls-logo.png" alt="ARMLS" loading="lazy" decoding="async" className="h-6 object-contain" />
                  </div>
                )}

                {(property.list_office_name || property.listing_office_name) && (
                  <p className="font-medium">
                    Listing courtesy of {property.list_office_name || property.listing_office_name}
                  </p>
                )}

                {/* ARMLS Rule 23.2.12: Display listing agent name + email or phone */}
                {(property.listing_agent_name || property.listing_agent_email || property.listing_agent_phone) && (
                  <div>
                    <p>Listing Agent: {property.listing_agent_name}</p>
                    {property.listing_agent_email && <p className="text-[10px]">{property.listing_agent_email}</p>}
                    {property.listing_agent_phone && <p className="text-[10px]">{property.listing_agent_phone}</p>}
                  </div>
                )}

                <p className="text-[10px] italic pt-2 border-t border-border">
                  All information should be verified by the recipient and none is guaranteed
                  as accurate by ARMLS. Information source: ARMLS.
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ======================================================================
          SIMILAR HOMES RAIL
          ----------------------------------------------------------------------
          Up to 6 properties matching the same city, ±20% price, ±1 bedroom.
          Reuses the upgraded PropertyCard component so each rail card shows
          $/sqft, lot size, days on market, and the New badge automatically.
          Hidden if zero matches found (no awkward "0 similar homes" state).
          ====================================================================== */}
      {similarHomes.length > 0 && (
        <div className="bg-muted py-12 md:py-16">
          <div className="crandell-container">
            <div className="mb-8">
              <p className="text-primary uppercase tracking-wider text-sm font-semibold mb-2">
                Comparable listings
              </p>
              <h2 className="text-2xl md:text-3xl font-normal text-foreground">
                More homes in {property.city}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Similar size and price range, hand-picked by your search.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {similarHomes.map((similarProperty) => (
                <PropertyCard
                  key={similarProperty.id}
                  property={similarProperty}
                  user={user}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {user && property && (
        <AIAssistant user={user} contextData={{ currentProperty: { address: property.address, price: property.price, bedrooms: property.bedrooms, bathrooms: property.bathrooms } }} />
      )}

      {/* Fullscreen Image Modal */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Property image fullscreen view"
        >
          <button type="button" onClick={() => setIsFullscreen(false)} aria-label="Close fullscreen" className="absolute top-4 right-4 h-12 w-12 bg-black/90 hover:bg-black backdrop-blur-sm rounded-full flex items-center justify-center z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><X className="h-6 w-6 text-white" aria-hidden="true" /></button>
          <div className="relative w-full h-full flex items-center justify-center p-4" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            <img src={images[currentImageIndex]} alt={images.length > 1 ? `${property.address}, image ${currentImageIndex + 1} of ${images.length}` : property.address} decoding="async" className="w-full h-full object-contain" />
            {images.length > 1 && (
              <>
                <button type="button" onClick={handlePrevImage} aria-label="Previous image" className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronLeft className="h-7 w-7 text-white" aria-hidden="true" /></button>
                <button type="button" onClick={handleNextImage} aria-label="Next image" className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ChevronRight className="h-7 w-7 text-white" aria-hidden="true" /></button>
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-white font-medium" aria-live="polite" aria-atomic="true"><span className="sr-only">Image </span>{currentImageIndex + 1} / {images.length}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
