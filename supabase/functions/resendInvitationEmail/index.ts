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

    // Parse request body
    const { user_id } = await req.json();
    if (!user_id) {
      return jsonResponse({ error: 'Missing required field: user_id' }, 400);
    }

    const admin = getServiceClient();

    // Fetch target user from profiles
    const { data: targetUser, error: fetchError } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (fetchError || !targetUser) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    // Send invitation email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return jsonResponse({ error: 'Resend API key not configured' }, 500);
    }

    const invitationLink = `${Deno.env.get('SUPABASE_URL')}/auth/v1/verify`;

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Crandell Home Intelligence <noreply@crandellhomeintelligence.com>',
        to: [targetUser.email],
        subject: 'You have been invited to Crandell Home Intelligence',
        html: `
          <h1>You're Invited!</h1>
          <p>Hello ${targetUser.full_name || 'there'},</p>
          <p>You have been invited to join Crandell Home Intelligence.</p>
          <p>Click the link below to accept the invitation and set up your account:</p>
          <p><a href="${invitationLink}">${invitationLink}</a></p>
          <p>If you did not expect this invitation, please ignore this email.</p>
          <p>Best regards,<br>The Crandell Home Intelligence Team</p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.json();
      return jsonResponse(
        { error: 'Failed to send invitation email', details: error },
        500
      );
    }

    return jsonResponse({
      success: true,
      message: `Invitation email sent to ${targetUser.email}`,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
