import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface SyncContactRequest {
  contact_email: string;
  contact_name?: string;
  contact_id?: string;
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
    // Authenticate and check admin
    const user = await getUser(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const isAdmin = user.is_admin === true || user.is_user_admin === true;
    if (!isAdmin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const body: SyncContactRequest = await req.json();
    const { contact_email, contact_name, contact_id } = body;

    if (!contact_email) {
      return jsonResponse({ error: 'contact_email is required' }, 400);
    }

    const supabase = getServiceClient();
    const fubApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');

    if (!fubApiKey) {
      return jsonResponse(
        { error: 'Follow Up Boss API key not configured' },
        400
      );
    }

    // Fetch contact from FUB
    let fubContact: any = null;
    if (contact_id) {
      const fubResponse = await fetch(
        `https://api.followupboss.com/api/v1/contacts/${contact_id}`,
        {
          headers: {
            'Authorization': `Bearer ${fubApiKey}`,
          },
        }
      );

      if (fubResponse.ok) {
        const fubData = await fubResponse.json();
        fubContact = fubData.data || fubData;
      }
    }

    // Get active fub_field_mappings
    const { data: fieldMappings } = await supabase
      .from('fub_field_mappings')
      .select('*')
      .eq('is_active', true);

    // Check if user exists in profiles
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', contact_email)
      .single();

    const syncedFields: Record<string, any> = {};
    if (fubContact) {
      // Map FUB fields to profile fields using field mappings
      for (const mapping of fieldMappings || []) {
        const fubField = mapping.fub_field_name;
        const profileField = mapping.profile_field_name;
        if (fubContact[fubField] !== undefined) {
          syncedFields[profileField] = fubContact[fubField];
        }
      }
    }

    if (existingProfile) {
      // Update existing profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          ...syncedFields,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingProfile.id);

      if (updateError) {
        return jsonResponse(
          { error: 'Failed to update profile', details: updateError },
          400
        );
      }

      // Log to fub_sync_history
      await supabase.from('fub_sync_history').insert({
        profile_id: existingProfile.id,
        fub_contact_id: contact_id,
        action: 'updated',
        synced_fields: Object.keys(syncedFields),
        sync_timestamp: new Date().toISOString(),
      });

      return jsonResponse({
        success: true,
        synced_fields: syncedFields,
      });
    } else {
      // Invite new user via auth.admin.inviteUserByEmail
      const adminAuthClient = supabase.auth.admin;
      const { data: inviteData, error: inviteError } = await adminAuthClient.inviteUserByEmail(contact_email);

      if (inviteError) {
        return jsonResponse(
          { error: 'Failed to invite user', details: inviteError },
          400
        );
      }

      // Create profile for new user
      const newUserId = inviteData.user?.id;
      if (newUserId) {
        const [firstName, ...lastNameParts] = (contact_name || '').split(' ');
        const lastName = lastNameParts.join(' ');

        const { error: profileError } = await supabase.from('profiles').insert({
          id: newUserId,
          email: contact_email,
          first_name: firstName || '',
          last_name: lastName || '',
          ...syncedFields,
          created_at: new Date().toISOString(),
        });

        if (profileError) {
          console.error('Failed to create profile:', profileError);
        }

        // Log to fub_sync_history
        await supabase.from('fub_sync_history').insert({
          profile_id: newUserId,
          fub_contact_id: contact_id,
          action: 'invited',
          synced_fields: Object.keys(syncedFields),
          sync_timestamp: new Date().toISOString(),
        });
      }

      return jsonResponse({
        success: true,
        synced_fields: syncedFields,
      });
    }
  } catch (error) {
    console.error('Error in syncSingleFollowUpBossContact:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
