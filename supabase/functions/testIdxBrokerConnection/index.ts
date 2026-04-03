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
    if (!user || !user.is_admin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    // Read environment variable
    const idxBrokerApiKey = Deno.env.get('IDX_BROKER_API_KEY');

    if (!idxBrokerApiKey) {
      return jsonResponse({
        configured: false,
        connection_successful: false,
      });
    }

    // Test connection to IDX Broker API
    try {
      const testResponse = await fetch(
        'https://api.idxbroker.com/v1/account',
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${idxBrokerApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const connectionSuccessful = testResponse.ok;

      return jsonResponse({
        configured: true,
        connection_successful: connectionSuccessful,
      });
    } catch (error) {
      console.error('IDX Broker connection test error:', error);
      return jsonResponse({
        configured: true,
        connection_successful: false,
      });
    }
  } catch (error) {
    console.error('Error in testIdxBrokerConnection:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
