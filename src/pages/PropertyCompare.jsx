import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Bed, Bath, Square, Calendar, MapPin, TrendingUp, Loader2, Sparkles } from 'lucide-react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import ReactMarkdown from 'react-markdown';

export default function PropertyCompare() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [propertyIds, setPropertyIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = params.get('ids');
    if (ids) setPropertyIds(ids.split(','));
    else navigate(createPageUrl('Search'));
  }, []);

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties-compare', propertyIds],
    queryFn: async () => {
      if (propertyIds.length === 0) return [];
      const { data } = await supabase.from('properties').select('*').in('id', propertyIds);
      return data || [];
    },
    enabled: propertyIds.length > 0
  });

  const generateComparison = async () => {
    if (propertyIds.length < 2) return;
    setIsLoadingAI(true);
    try {
      const data = await invokeFunction('generatePropertyComparison', { property_ids: propertyIds });
      setComparison(data.comparison);
    } catch (error) {
      console.error('Failed to generate comparison:', error);
    } finally {
      setIsLoadingAI(false);
    }
  };

  useEffect(() => {
    if (properties.length >= 2 && !comparison) generateComparison();
  }, [properties]);

  if (isLoadingAuth) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>;
  if (!isAuthenticated) return <Navigate to="/Login" replace />;

  const formatPrice = (price) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price);

  const getValueDifference = (field) => {
    if (properties.length < 2) return [];
    const values = properties.map(p => p[field] || 0);
    const max = Math.max(...values);
    const min = Math.min(...values);
    return properties.map(p => {
      const val = p[field] || 0;
      if (val === max && max !== min) return 'highest';
      if (val === min && max !== min) return 'lowest';
      return 'neutral';
    });
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>;

  if (properties.length < 2) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 text-lg mb-4">Not enough properties to compare</p>
          <Link to={createPageUrl('Search')}><Button>Back to Search</Button></Link>
        </div>
      </div>
    );
  }

  const priceHighlight = getValueDifference('price');
  const bedsHighlight = getValueDifference('bedrooms');
  const bathsHighlight = getValueDifference('bathrooms');
  const sqftHighlight = getValueDifference('square_feet');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="crandell-container">
        <div className="mb-8">
          <Link to={createPageUrl('Search')}><Button variant="ghost" className="mb-4"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Search</Button></Link>
          <h1 className="text-3xl font-bold text-slate-900">Property Comparison</h1>
          <p className="text-slate-600 mt-2">Comparing {properties.length} properties side-by-side</p>
        </div>

        {comparison && (
          <Card className="mb-8 border-slate-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-slate-800 to-slate-600 text-white">
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> AI Comparison Analysis</CardTitle>
            </CardHeader>
            <CardContent className="p-6"><ReactMarkdown className="prose prose-slate max-w-none">{comparison}</ReactMarkdown></CardContent>
          </Card>
        )}

        {isLoadingAI && !comparison && (
          <Card className="mb-8 border-slate-200 shadow-lg">
            <CardContent className="p-8 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600 mr-3" />
              <span className="text-slate-600">Generating AI comparison...</span>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {properties.map((property, idx) => (
            <Card key={property.id} className="overflow-hidden shadow-lg border-slate-200">
              <div className="relative h-48">
                <img src={property.images?.[0] || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80'} alt={property.address} className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3"><Badge className="bg-slate-800 text-white">Property {idx + 1}</Badge></div>
              </div>
              <CardContent className="p-6 space-y-6">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Price</div>
                  <div className={`text-2xl font-bold ${priceHighlight[idx] === 'lowest' ? 'text-green-600' : priceHighlight[idx] === 'highest' ? 'text-red-600' : 'text-slate-900'}`}>
                    {formatPrice(property.price)}
                    {priceHighlight[idx] === 'lowest' && <span className="text-sm ml-2">Best Price</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Location</div>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-slate-700">{property.address}<br />{property.city}, {property.state} {property.zip_code}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-slate-600"><Bed className="h-4 w-4" /><span className="text-sm">Bedrooms</span></div><div className={`font-semibold ${bedsHighlight[idx] === 'highest' ? 'text-green-600' : 'text-slate-900'}`}>{property.bedrooms || 0}</div></div>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-slate-600"><Bath className="h-4 w-4" /><span className="text-sm">Bathrooms</span></div><div className={`font-semibold ${bathsHighlight[idx] === 'highest' ? 'text-green-600' : 'text-slate-900'}`}>{property.bathrooms || 0}</div></div>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-slate-600"><Square className="h-4 w-4" /><span className="text-sm">Square Feet</span></div><div className={`font-semibold ${sqftHighlight[idx] === 'highest' ? 'text-green-600' : 'text-slate-900'}`}>{property.square_feet?.toLocaleString() || 'N/A'}</div></div>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-slate-600"><Calendar className="h-4 w-4" /><span className="text-sm">Year Built</span></div><div className="font-semibold text-slate-900">{property.year_built || 'N/A'}</div></div>
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-slate-600"><TrendingUp className="h-4 w-4" /><span className="text-sm">Days on Market</span></div><div className="font-semibold text-slate-900">{property.days_on_market || 0}</div></div>
                </div>
                {property.features?.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Features</div>
                    <div className="flex flex-wrap gap-1.5">
                      {property.features.slice(0, 5).map((feature, i) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-slate-100 text-slate-700">{feature}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <Link to={createPageUrl('PropertyDetail') + `?id=${property.id}`}>
                  <Button className="w-full bg-slate-800 hover:bg-slate-700">View Full Details</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
