import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || (user.role !== 'admin' && user.is_user_admin !== true)) {
            return Response.json({ error: 'Forbidden: Admin or User Admin access required' }, { status: 403 });
        }

        let body;
        try {
            body = await req.json();
        } catch (parseErr) {
            return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }

        const { email, name, assigned_role } = body;

        if (!email) {
            return Response.json({ error: 'Email is required' }, { status: 400 });
        }

        // Invite the user
        try {
            await base44.users.inviteUser(email, 'user');
            
            // Update the invited user with assigned role and invited_by
            // Wait a moment for user creation to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const invitedUsers = await base44.asServiceRole.entities.User.filter({ email: email });
            if (invitedUsers.length > 0) {
                await base44.asServiceRole.entities.User.update(invitedUsers[0].id, {
                    assigned_role: assigned_role || 'lead',
                    invited_by: user.email,
                    full_name: name || invitedUsers[0].full_name
                });
            }

            // Send invitation email
            const appUrl = 'https://' + req.headers.get('host');
            const loginUrl = `${appUrl}/login`;
            
            await base44.asServiceRole.integrations.Core.SendEmail({
                to: email,
                subject: 'Welcome to HomeFinder - Complete Your Profile',
                body: `Hi ${name || 'there'},

${user.full_name || user.email} has invited you to join HomeFinder as a ${assigned_role || 'lead'}.

HomeFinder is your personalized real estate platform where you can:
• Search thousands of available properties
• Save your favorite homes
• Get AI-powered property insights and recommendations
• Connect with real estate agents

Click the link below to complete your profile and start exploring:
${loginUrl}

We look forward to helping you find your dream home!

Best regards,
The HomeFinder Team`
            });
            
            return Response.json({
                success: true,
                message: `Invitation sent to ${email}`,
                email: email,
                name: name || email
            });
        } catch (inviteError) {
            return Response.json({ 
                error: 'Failed to invite user',
                details: inviteError.message 
            }, { status: 400 });
        }

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});