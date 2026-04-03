import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { propertyId, userId, name, email, phone, message } = await req.json();
    if (!propertyId || !email) throw new Error('propertyId and email required');

    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('listing_key, street_number, street_name, city, list_price, listing_agent_name')
      .eq('id', propertyId)
      .single();

    const fubKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (fubKey) {
      const address = property ? `${property.street_number} ${property.street_name}, ${property.city}` : 'Unknown';
      await fetch('https://api.followupboss.com/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(fubKey + ':')}`,
        },
        body: JSON.stringify({
          source: 'HomeFind AI',
          type: 'Property Inquiry',
          person: { firstName: name?.split(' ')[0], lastName: name?.split(' ').slice(1).join(' '), emails: [{ value: email }], phones: phone ? [{ value: phone }] : [] },
          property: { street: address, mlsNumber: property?.listing_key, price: property?.list_price },
          message: message || `Inquiry about ${address}`,
        }),
      });
    }

    // Log the engagement
    if (userId) {
      await supabaseAdmin.from('engagement_alerts').insert({
        user_id: userId,
        alert_type: 'agent_contact',
        property_id: propertyId,
        metadata: { name, email, phone, message },
      });
    }

    return jsonResponse({ success: true, agent: property?.listing_agent_name });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
