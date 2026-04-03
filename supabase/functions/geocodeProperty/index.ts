import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { propertyId } = await req.json();
    if (!propertyId) throw new Error('propertyId required');

    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('street_number, street_name, street_suffix, city, state, zip_code')
      .eq('id', propertyId)
      .single();

    if (!property) throw new Error('Property not found');

    const address = `${property.street_number || ''} ${property.street_name || ''} ${property.street_suffix || ''}, ${property.city || ''}, ${property.state || 'AZ'} ${property.zip_code || ''}`.trim();

    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    const geoRes = await fetch(geocodeUrl, {
      headers: { 'User-Agent': 'HomeFind-AI/1.0' },
    });

    if (!geoRes.ok) throw new Error('Geocoding service error');

    const geoData = await geoRes.json();
    if (!geoData.length) return jsonResponse({ success: false, message: 'No geocode result' });

    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    const { error } = await supabaseAdmin
      .from('properties')
      .update({ latitude: lat, longitude: lon })
      .eq('id', propertyId);

    if (error) throw error;

    return jsonResponse({ success: true, latitude: lat, longitude: lon });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
