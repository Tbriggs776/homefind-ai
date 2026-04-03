import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // Admin only
    const user = await getUser(req);
    if (user && !user.is_admin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    // Placeholder: IDX Broker sync not yet implemented
    return jsonResponse({
      success: false,
      message: 'IDX Broker sync not yet implemented',
    });
  } catch (error) {
    console.error('Error in syncIdxBrokerListings:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
