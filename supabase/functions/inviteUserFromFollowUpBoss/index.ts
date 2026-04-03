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

    // Check authorization - admin or is_user_admin
    const isAuthorized =
      currentUser.role === 'admin' || currentUser.is_user_admin === true;
    if (!isAuthorized) {
      return jsonResponse({ error: 'Forbidden - insufficient permissions' }, 403);
    }

    // Parse request body
    const { email, name, assigned_role } = await req.json();
    if (!email || !name) {
      return jsonResponse(
        { error: 'Missing required fields: email, name' },
        400
      );
    }

    // Validate assigned_role if provided
    if (assigned_role && !['admin', 'user'].includes(assigned_role)) {
      return jsonResponse(
        { error: 'Invalid assigned_role. Must be "admin" or "user"' },
        400
      );
    }

    const admin = getServiceClient();

    // Invite via Supabase Auth
    const { data: inviteData, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email);

    if (inviteError) {
      return jsonResponse({ error: inviteError.message }, 500);
    }

    // Update profile with assigned_role and invited_by
    const { data: profileData, error: profileError } = await admin
      .from('profiles')
      .upsert(
        {
          id: inviteData.user.id,
          email,
          full_name: name,
          assigned_role: assigned_role || 'user',
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
            <p>Hello ${name},</p>
            <p>${currentUser.full_name} has invited you to join Crandell Home Intelligence.</p>
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

    return jsonResponse({
      success: true,
      message: `User ${email} invited successfully from Follow Up Boss`,
      data: profileData?.[0],
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
