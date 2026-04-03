import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Check if welcome email has already been sent
        if (user.welcome_email_sent) {
            return Response.json({ message: 'Welcome email already sent' }, { status: 200 });
        }

        // Send welcome email
        await base44.integrations.Core.SendEmail({
            to: user.email,
            subject: 'Welcome to Crandell Home Intelligence',
            body: `
Hi ${user.full_name || 'there'},

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

        // Mark welcome email as sent on the user
        await base44.auth.updateMe({ welcome_email_sent: true });

        return Response.json({ success: true, message: 'Welcome email sent' });
    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});