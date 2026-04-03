import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const currentUser = await getUser(req);
    if (!currentUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check authorization - admin only
    if (currentUser.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden - admin access required' }, 403);
    }

    // Parse request body
    const { email, full_name } = await req.json();
    if (!email) {
      return jsonResponse({ error: 'Missing required field: email' }, 400);
    }

    const admin = getServiceClient();

    // Invite user via Supabase Auth admin
    const { data: inviteData, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email);

    if (inviteError) {
      return jsonResponse({ error: inviteError.message }, 500);
    }

    // Create or update profile with is_user_admin=true
    const { data: profileData, error: profileError } = await admin
      .from('profiles')
      .upsert(
        {
          id: inviteData.user.id,
          email,
          full_name: full_name || '',
          is_user_admin: true,
          invited_by: currentUser.email,
          status: 'pending',
        },
        { onConflict: 'id' }
      )
      .select();

    if (profileError) {
      return jsonResponse({ error: profileError.message }, 500);
    }

    // Send invitation email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      const invitationLink = `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify`;

      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Crandell Home Intelligence <noreply@crandellhomeintelligence.com>',
          to: [email],
          subject: 'You have been invited to Crandell Home Intelligence',
          html: `
            <h1>You're Invited!</h1>
            <p>Hello ${full_name || 'there'},</p>
            <p>${currentUser.full_name} has invited you to join Crandell Home Intelligence as an admin user.</p>
            <p>Click the link below to accept the invitation and set up your account:</p>
            <p><a href="${invitationLink}">${invitationLink}</a></p>
            <p>If you did not expect this invitation, please ignore this email.</p>
            <p>Best regards,<br>The Crandell Home Intelligence Team</p>
          `,
        }),
      });

      if (!emailResponse.ok) {
        console.error('Failed to send invitation email');
      }
    }

    // Sync to Follow Up Boss if API key configured
    const followUpBossApiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
    if (followUpBossApiKey) {
      try {
        await fetch('https://api.followupboss.com/v1/contacts', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${btoa(`:${followUpBossApiKey}`)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            firstName: full_name || '',
            email,
            source: 'admin_invitation',
          }),
        });
      } catch (err) {
        console.error('Failed to sync to Follow Up Boss:', err);
      }
    }

    return jsonResponse({
      success: true,
      message: `Admin user ${email} invited successfully`,
      data: profileData?.[0],
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
