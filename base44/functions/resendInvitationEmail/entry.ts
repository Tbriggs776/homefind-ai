import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { user_id } = await req.json();

        if (!user_id) {
            return Response.json({ error: 'user_id is required' }, { status: 400 });
        }

        // Get the user to resend invitation to
        const targetUser = await base44.asServiceRole.entities.User.get(user_id);

        if (!targetUser) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Send invitation email
        await base44.integrations.Core.SendEmail({
            to: targetUser.email,
            subject: 'You\'ve been invited to Crandell Home Intelligence',
            body: `
Hi ${targetUser.full_name || 'there'},

You've been invited to Crandell Home Intelligence to join as a ${targetUser.assigned_role || 'user'}.

Click the link below to accept the invitation and set up your account:
https://www.crandellhomeintelligence.com

Once you sign up, you'll have access to:
- Browse thousands of active listings
- Save your favorite properties
- Get personalized recommendations powered by AI
- Track property updates and trends

If you have any questions, please reach out to your administrator.

Best regards,
The Crandell Home Intelligence Team
            `
        });

        return Response.json({ success: true, message: 'Invitation email resent successfully' });
    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});