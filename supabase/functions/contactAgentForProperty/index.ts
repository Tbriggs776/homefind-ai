import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface ContactRequest {
  property: {
    id?: string;
    external_listing_id?: string;
    address?: string;
    city?: string;
    state?: string;
    price?: number;
    [key: string]: any;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // Authenticate user
    const user = await getUser(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body: ContactRequest = await req.json();
    const { property } = body;

    if (!property) {
      return jsonResponse({ error: 'Property is required' }, 400);
    }

    const supabase = getServiceClient();

    // Check if property is already saved
    const propertyId = property.id || property.external_listing_id;
    if (propertyId) {
      const { data: existingSaved } = await supabase
        .from('saved_properties')
        .select('id')
        .eq('user_id', user.id)
        .eq('property_id', propertyId)
        .single();

      // Auto-save property if not already saved
      if (!existingSaved) {
        await supabase.from('saved_properties').insert({
          user_id: user.id,
          property_id: propertyId,
          saved_at: new Date().toISOString(),
        });
      }
    }

    // Send event to Follow Up Boss Events API
    const fubApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (!fubApiKey) {
      console.warn('Follow Up Boss API key not configured');
      return jsonResponse(
        {
          success: false,
          message: 'Follow Up Boss integration not configured',
          action: 'saved',
        },
        400
      );
    }

    const fubPayload = {
      event: 'PropertyInquiry',
      email: user.email,
      first_name: user.first_name || 'User',
      last_name: user.last_name || '',
      phone: user.phone || '',
      property_address: `${property.address || ''}, ${property.city || ''}, ${property.state || ''}`,
      property_price: property.price,
      property_beds: property.beds,
      property_baths: property.baths,
      mls_number: property.mls_number,
      timestamp: new Date().toISOString(),
    };

    const fubResponse = await fetch(
      'https://api.followupboss.com/api/v1/events/track',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fubApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fubPayload),
      }
    );

    let leadId = null;
    if (fubResponse.ok) {
      const fubData = await fubResponse.json();
      leadId = fubData.leadId || fubData.id;
    } else {
      console.error('FUB API error:', fubResponse.status, await fubResponse.text());
    }

    return jsonResponse({
      success: true,
      message: 'Property inquiry sent to agent',
      action: 'contacted',
      leadId,
    });
  } catch (error) {
    console.error('Error in contactAgentForProperty:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
