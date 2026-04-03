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

    // Read environment variables
    const sparkApiKey = Deno.env.get('SPARK_API_KEY');
    const sparkAccessToken = Deno.env.get('SPARK_ACCESS_TOKEN') ||
                             Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');

    if (!sparkApiKey && !sparkAccessToken) {
      return jsonResponse({
        configured: false,
        connection_successful: false,
        status: 'No Spark API credentials configured',
        listings_available: false,
        sample_listing: null,
      });
    }

    // Test connection to Spark Replication API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (sparkAccessToken) {
      headers['Authorization'] = `Bearer ${sparkAccessToken}`;
    } else if (sparkApiKey) {
      headers['X-API-Key'] = sparkApiKey;
    }

    try {
      const testResponse = await fetch(
        'https://api.sparkplatform.com/v1/listings?pageSize=1&_filter=ListModificationTimestamp%3E=2024-01-01',
        {
          method: 'GET',
          headers,
        }
      );

      if (!testResponse.ok) {
        return jsonResponse({
          configured: true,
          connection_successful: false,
          status: `Connection failed with status ${testResponse.status}`,
          listings_available: false,
          sample_listing: null,
        });
      }

      const data = await testResponse.json();
      const listings = data.D?.Results || data.listings || [];
      const sampleListing = listings.length > 0 ? listings[0] : null;

      return jsonResponse({
        configured: true,
        connection_successful: true,
        status: 'Connected successfully',
        listings_available: listings.length > 0,
        sample_listing: sampleListing,
      });
    } catch (fetchError) {
      return jsonResponse({
        configured: true,
        connection_successful: false,
        status: `Connection error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
        listings_available: false,
        sample_listing: null,
      });
    }
  } catch (error) {
    console.error('Error in testSparkApiConnection:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
