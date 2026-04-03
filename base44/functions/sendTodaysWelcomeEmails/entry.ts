import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        // Only admins can trigger this
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Get all users
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 10000);

        // Filter for users created today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todaysUsers = allUsers.filter(u => {
            const created = new Date(u.created_date);
            return created >= today && created < tomorrow;
        });

        // Filter out those who already got the welcome email
        const usersToEmail = todaysUsers.filter(u => !u.welcome_email_sent);

        let sent = 0;
        let failed = 0;
        const errors = [];

        // Send emails to each user
        for (const userData of usersToEmail) {
            try {
                await base44.integrations.Core.SendEmail({
                    to: userData.email,
                    subject: 'Welcome to Crandell Home Intelligence',
                    body: `
Hi ${userData.full_name || 'there'},

Welcome to Crandell Home Intelligence! We're excited to have you on board.

Start exploring our extensive catalog of properties tailored to your needs:
- Browse thousands of active listings
- Save your favorite properties
- Get personalized recommendations powered by AI
- Track property updates and trends

Get started by visiting our search page: https://www.crandellhomeintelligence.com/search

If you have any questions or need assistance, we're here to help!

Best regards,
The Crandell Home Intelligence Team
                    `
                });

                // Mark email as sent
                await base44.asServiceRole.entities.User.update(userData.id, { welcome_email_sent: true });
                sent++;
            } catch (error) {
                failed++;
                errors.push({ email: userData.email, error: error.message });
            }
        }

        return Response.json({
            success: true,
            total_todays_users: todaysUsers.length,
            emails_sent: sent,
            emails_failed: failed,
            already_sent: todaysUsers.length - usersToEmail.length,
            errors: errors.length > 0 ? errors : null
        });
    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});