import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface FubContact {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // Authenticate and check admin
    const user = await getUser(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const isAdmin = user.is_admin === true;
    if (!isAdmin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const supabase = getServiceClient();
    const fubApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');

    if (!fubApiKey) {
      return jsonResponse(
        { error: 'Follow Up Boss API key not configured' },
        400
      );
    }

    // Fetch contacts from Follow Up Boss API
    const fubResponse = await fetch(
      'https://api.followupboss.com/api/v1/contacts?limit=1000',
      {
        headers: {
          'Authorization': `Bearer ${fubApiKey}`,
        },
      }
    );

    if (!fubResponse.ok) {
      return jsonResponse(
        { error: 'Failed to fetch FUB contacts', status: fubResponse.status },
        400
      );
    }

    const fubData = await fubResponse.json();
    let contacts: FubContact[] = fubData.data || fubData.contacts || [];

    // If user is user_admin, filter by their assigned FUB user
    if (user.is_user_admin === true && user.fub_user_id) {
      contacts = contacts.filter(
        (c: any) => c.assignedTo === user.fub_user_id || c.ownerId === user.fub_user_id
      );
    }

    // Cross-reference with profiles table
    const invitedUsers = [];
    const uninvitedContacts = [];

    for (const contact of contacts) {
      if (!contact.email) {
        uninvitedContacts.push(contact);
        continue;
      }

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('email', contact.email)
        .single();

      if (existingProfile) {
        invitedUsers.push({
          ...contact,
          invited: true,
          profile_id: existingProfile.id,
        });
      } else {
        uninvitedContacts.push(contact);
      }
    }

    return jsonResponse({
      total_contacts: contacts.length,
      invited_users: invitedUsers.length,
      uninvited_contacts: uninvitedContacts.length,
      contacts: {
        invited: invitedUsers,
        uninvited: uninvitedContacts,
      },
    });
  } catch (error) {
    console.error('Error in syncFollowUpBossContacts:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
