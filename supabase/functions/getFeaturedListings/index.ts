import { getServiceClient, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = getServiceClient();

    // Fetch featured properties for the specific agent
    const { data: properties, error: propertiesError } = await supabase
      .from('properties')
      .select('*')
      .eq('list_agent_mls_id', 'pc295')
      .eq('status', 'active')
      .order('price', { ascending: false })
      .limit(50);

    if (propertiesError) {
      return jsonResponse(
        { error: 'Failed to fetch properties', details: propertiesError },
        400
      );
    }

    // Map to response with is_featured flag
    const mappedProperties = (properties || []).map((prop: any) => ({
      ...prop,
      is_featured: true,
    }));

    return jsonResponse({
      properties: mappedProperties,
      total_active_listings: '38,000+',
    });
  } catch (error) {
    console.error('Error in getFeaturedListings:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
