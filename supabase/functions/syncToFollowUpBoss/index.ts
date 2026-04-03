import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

interface SyncToFubRequest {
  alert_id: string;
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
    // Admin only
    const user = await getUser(req);
    if (!user || !user.is_admin) {
      return jsonResponse({ error: 'Admin access required' }, 403);
    }

    const body: SyncToFubRequest = await req.json();
    const { alert_id } = body;

    if (!alert_id) {
      return jsonResponse({ error: 'alert_id is required' }, 400);
    }

    const supabase = getServiceClient();
    const fubApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');

    if (!fubApiKey) {
      return jsonResponse(
        { error: 'Follow Up Boss API key not configured' },
        400
      );
    }

    // Get engagement_alert by id
    const { data: alert, error: alertError } = await supabase
      .from('engagement_alerts')
      .select('*')
      .eq('id', alert_id)
      .single();

    if (alertError || !alert) {
      return jsonResponse(
        { error: 'Alert not found', details: alertError },
        404
      );
    }

    // Get user from profiles
    const { data: userProfile, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', alert.user_id)
      .single();

    if (userError || !userProfile) {
      return jsonResponse(
        { error: 'User not found', details: userError },
        404
      );
    }

    // Create or update person in FUB
    const personPayload = {
      firstName: userProfile.first_name || '',
      lastName: userProfile.last_name || '',
      email: userProfile.email,
      phone: userProfile.phone || '',
    };

    const fubPersonResponse = await fetch(
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

    if (!fubPersonResponse.ok) {
      console.error('FUB person creation failed:', fubPersonResponse.status);
      return jsonResponse(
        { error: 'Failed to create person in FUB', status: fubPersonResponse.status },
        400
      );
    }

    const fubPerson = await fubPersonResponse.json();
    const person_id = fubPerson.data?.id || fubPerson.id;

    // Add note with alert details
    const notePayload = {
      personId: person_id,
      body: `Engagement Alert: ${alert.alert_type}\n\nDetails: ${alert.details || ''}\n\nCreated: ${alert.created_at}`,
    };

    await fetch(
      `https://api.followupboss.com/api/v1/contacts/${person_id}/notes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fubApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notePayload),
      }
    );

    // Create task
    const taskPayload = {
      personId: person_id,
      name: `Follow up: ${alert.alert_type}`,
      description: alert.details || '',
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };

    await fetch(
      `https://api.followupboss.com/api/v1/tasks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fubApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskPayload),
      }
    );

    // Update alert status to 'action_taken'
    const { error: updateError } = await supabase
      .from('engagement_alerts')
      .update({
        status: 'action_taken',
        updated_at: new Date().toISOString(),
      })
      .eq('id', alert_id);

    if (updateError) {
      console.error('Failed to update alert status:', updateError);
    }

    return jsonResponse({
      success: true,
      person_id,
    });
  } catch (error) {
    console.error('Error in syncToFollowUpBoss:', error);
    return jsonResponse(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
