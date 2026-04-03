import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (!user || user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { data: allUsers } = await admin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10000);

        if (!allUsers) {
            return jsonResponse({ success: true, total_todays_users: 0, emails_sent: 0, emails_failed: 0, already_sent: 0 });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todaysUsers = allUsers.filter(u => {
            const created = new Date(u.created_at);
            return created >= today && created < tomorrow;
        });

        const usersToEmail = todaysUsers.filter(u => !u.welcome_email_sent);

        let sent = 0;
        let failed = 0;
        const errors = [];

        for (const userData of usersToEmail) {
            try {
                // Send email via Resend API (or your email service)
                const emailResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'Crandell Home Intelligence <noreply@crandellhomeintelligence.com>',
                        to: userData.email,
                        subject: 'Welcome to Crandell Home Intelligence',
                        html: `
<p>Hi ${userData.full_name || 'there'},</p>

<p>Welcome to Crandell Home Intelligence! We're excited to have you on board.</p>

<p>Start exploring our extensive catalog of properties tailored to your needs:
<ul>
<li>Browse thousands of active listings</li>
<li>Save your favorite properties</li>
<li>Get personalized recommendations powered by AI</li>
<li>Track property updates and trends</li>
</ul>
</p>

<p>Get started by visiting our search page: <a href="https://www.crandellhomeintelligence.com/search">https://www.crandellhomeintelligence.com/search</a></p>

<p>If you have any questions or need assistance, we're here to help!</p>

<p>Best regards,<br>The Crandell Home Intelligence Team</p>
                        `
                    })
                });

                if (emailResponse.ok) {
                    await admin
                        .from('profiles')
                        .update({ welcome_email_sent: true })
                        .eq('id', userData.id);
                    sent++;
                } else {
                    failed++;
                    const errorText = await emailResponse.text();
                    errors.push({ email: userData.email, error: errorText });
                }
            } catch (error) {
                failed++;
                errors.push({ email: userData.email, error: (error as Error).message });
            }
        }

        return jsonResponse({
            success: true,
            total_todays_users: todaysUsers.length,
            emails_sent: sent,
            emails_failed: failed,
            already_sent: todaysUsers.length - usersToEmail.length,
            errors: errors.length > 0 ? errors : null
        });
    } catch (error) {
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
