import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { userId, email, name } = await req.json();
    const resendKey = Deno.env.get('RESEND_API_KEY');

    if (!resendKey) {
      console.log('RESEND_API_KEY not set, skipping email');
      return jsonResponse({ success: true, skipped: true, reason: 'No email provider configured' });
    }

    const firstName = name?.split(' ')[0] || 'there';

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Crandell Real Estate <noreply@crandellrealestate.com>',
        to: [email],
        subject: `Welcome to HomeFind AI, ${firstName}!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1a365d;">Welcome to HomeFind AI!</h1>
            <p>Hi ${firstName},</p>
            <p>Thank you for joining the Crandell Real Estate Team's property search platform. Here's what you can do:</p>
            <ul>
              <li><strong>Search</strong> 38,000+ ARMLS listings with advanced filters</li>
              <li><strong>Save</strong> your favorite properties and get alerts</li>
              <li><strong>Compare</strong> properties side by side</li>
              <li><strong>Chat</strong> with our AI assistant for personalized recommendations</li>
            </ul>
            <p><a href="https://crandellrealestate.com" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Start Searching</a></p>
            <p style="color: #666; font-size: 12px;">Crandell Real Estate Team | Balboa Realty</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Email send failed: ${errText}`);
    }

    if (userId) {
      await supabaseAdmin.from('profiles').update({ welcome_email_sent: true }).eq('id', userId);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
