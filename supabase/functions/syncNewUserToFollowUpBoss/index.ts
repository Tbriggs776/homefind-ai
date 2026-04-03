import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface SyncNewUserRequest {
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
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
    const supabase = getServiceClient();
    const fubApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');

    if (!fubApiKey) {
      return jsonResponse(
        { error: 'Follow Up Boss API key not configured' },
        400
      );
    }

    // Get email and name from request body or from authenticated user
    let email: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;

    if (req.method === 'POST') {
      const body: SyncNewUserRequest = await req.json();
      email = body.email;
      firstName = body.first_name || body.name?.split(' ')[0];
      lastName = body.last_name || body.name?.split(' ').slice(1).join(' ');
    }

    // If not in body, try to get from authenticated user
    if (!email) {
      const user = await getUser(req);
      if (!user) {
        return jsonResponse({ error: 'Email is required in body or must be authenticated' }, 400);
      }
      email = user.email;
      firstName = user.first_name;
      lastName = user.last_name;
    }

    if (!email) {
      return jsonResponse({ error: 'Email is required' }, 400);
    }

    // Create or update person in Follow Up Boss
    const personPayload = {
      email,
      firstName: firstName || '',
      lastName: lastName || '',
    };

    const fubResponse = await fetch(
      'https://api.followupboss.com/api/v1/contacts',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fubApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(personPayload),
      }
    );

    if (!fubResponse.ok) {
      console.error('FUB API error:', fubResponse.status, await fubResponse.text());
      return jsonResponse(
        { error: 'Failed to create/update person in FUB', status: fubResponse.status },
        400
      );
    }

    const fubData = await fubResponse.json();
    const person_id = fubData.data?.id || fubData.id;
    const action = fubData.data?.created ? 'created' : 'updated';

    return jsonResponse({
      success: true,
      person_id,
      action,
    });
  } catch (error) {
    console.error('Error in syncNewUserToFollowUpBoss:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
