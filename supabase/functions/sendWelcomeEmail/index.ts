import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get authenticated user
    const user = await getUser(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check if welcome email has already been sent
    if (user.welcome_email_sent) {
      return jsonResponse({
        success: false,
        message: 'Welcome email has already been sent',
      });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return jsonResponse({ error: 'Resend API key not configured' }, 500);
    }

    // Send welcome email via Resend
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Crandell Home Intelligence <noreply@crandellhomeintelligence.com>',
        to: [user.email],
        subject: 'Welcome to Crandell Home Intelligence',
        html: `
          <h1>Welcome ${user.full_name || 'to Crandell Home Intelligence'}</h1>
          <p>We're excited to have you on board. Your account is now active and ready to use.</p>
          <p>If you have any questions, feel free to reach out to our support team.</p>
          <p>Best regards,<br>The Crandell Home Intelligence Team</p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.json();
      return jsonResponse(
        { error: 'Failed to send welcome email', details: error },
        500
      );
    }

    // Update profile with welcome_email_sent = true
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('profiles')
      .update({ welcome_email_sent: true })
      .eq('id', user.id)
      .select();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({
      success: true,
      message: 'Welcome email sent successfully',
      data,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
