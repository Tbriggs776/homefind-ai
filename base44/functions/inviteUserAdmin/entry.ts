import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        let body;
        try {
            body = await req.json();
        } catch (parseErr) {
            return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }

        const { email, full_name } = body;

        if (!email) {
            return Response.json({ error: 'Email is required' }, { status: 400 });
        }

        // Invite the user as regular user first
        try {
            await base44.users.inviteUser(email, 'user');
            
            // Wait for user creation to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Update the invited user to be a user admin
            const invitedUsers = await base44.asServiceRole.entities.User.filter({ email: email });
            if (invitedUsers.length > 0) {
                await base44.asServiceRole.entities.User.update(invitedUsers[0].id, {
                    is_user_admin: true,
                    full_name: full_name || invitedUsers[0].full_name,
                    invited_by: user.email
                });
            }

            // Send invitation email
            const appUrl = 'https://' + req.headers.get('host');
            const loginUrl = `${appUrl}/login`;
            
            await base44.asServiceRole.integrations.Core.SendEmail({
                to: email,
                subject: 'Welcome to HomeFinder - User Admin Access',
                body: `Hi ${full_name || 'there'},

${user.full_name || user.email} has invited you to join HomeFinder as a User Admin.

As a User Admin, you'll have special privileges to:
• Manage and invite users
• View user activity and engagement
• Access the admin dashboard
• Monitor Follow Up Boss integration

Click the link below to complete your profile and access the admin panel:
${loginUrl}

Welcome to the team!

Best regards,
The HomeFinder Team`
            });
            
            // Sync the invited user to Follow Up Boss
            try {
                const fubApiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");
                if (fubApiKey) {
                    const fubHeaders = {
                        'Authorization': `Basic ${btoa(fubApiKey + ':')}`,
                        'Content-Type': 'application/json'
                    };
                    const nameParts = (full_name || '').trim().split(' ');
                    const firstName = nameParts[0] || email.split('@')[0];
                    const lastName = nameParts.slice(1).join(' ') || '';

                    // Check if exists
                    const searchRes = await fetch(
                        `https://api.followupboss.com/v1/people?email=${encodeURIComponent(email)}&limit=1`,
                        { method: 'GET', headers: fubHeaders }
                    );
                    let existingId = null;
                    if (searchRes.ok) {
                        const sd = await searchRes.json();
                        const people = sd.people || sd._embedded?.people || [];
                        if (people.length > 0) existingId = people[0].id;
                    }

                    const personPayload = {
                        firstName,
                        ...(lastName && { lastName }),
                        emails: [{ value: email }],
                        source: 'Crandell Home Intelligence'
                    };

                    if (existingId) {
                        await fetch(`https://api.followupboss.com/v1/people/${existingId}`, {
                            method: 'PUT', headers: fubHeaders, body: JSON.stringify(personPayload)
                        });
                    } else {
                        await fetch('https://api.followupboss.com/v1/people', {
                            method: 'POST', headers: fubHeaders, body: JSON.stringify(personPayload)
                        });
                    }
                }
            } catch (fubError) {
                console.log('FUB sync failed (non-fatal):', fubError.message);
            }

            return Response.json({
                success: true,
                message: `User admin invitation sent to ${email}`,
                email: email
            });
        } catch (inviteError) {
            return Response.json({ 
                error: 'Failed to invite user admin',
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