import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const apiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'Follow Up Boss API key not configured' }, { status: 500 });
        }

        const { alert_id } = await req.json();

        if (!alert_id) {
            return Response.json({ error: 'alert_id is required' }, { status: 400 });
        }

        // Get the alert
        const alert = await base44.asServiceRole.entities.EngagementAlert.get(alert_id);
        if (!alert) {
            return Response.json({ error: 'Alert not found' }, { status: 404 });
        }

        // Get user details
        const users = await base44.asServiceRole.entities.User.filter({ email: alert.user_email });
        const userData = users[0];

        // Create/update person in Follow Up Boss
        const fullName = alert.user_name || userData?.full_name || alert.user_email.split('@')[0];
        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const personPayload = {
            emails: [{ value: alert.user_email }],
            firstName,
            lastName,
            source: 'Crandell Home Intelligence',
            tags: 'engagement_alert'
        };

        const personResponse = await fetch('https://api.followupboss.com/v1/people', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(apiKey + ':'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(personPayload)
        });

        if (!personResponse.ok) {
            const errorText = await personResponse.text();
            return Response.json({ 
                error: 'Failed to create person in Follow Up Boss',
                details: errorText 
            }, { status: 500 });
        }

        const personData = await personResponse.json();

        // Create a note on the person
        const personId = personData.id || personData.person?.id;
        const noteBody = `Engagement Alert: ${alert.alert_type.replace(/_/g, ' ').toUpperCase()}\n\n${alert.ai_summary || 'User engagement has changed.'}\n\nPrevious Score: ${alert.previous_engagement_score || 'N/A'}\nCurrent Score: ${alert.current_engagement_score || 'N/A'}\n${alert.drop_percentage ? `Drop: ${alert.drop_percentage}%\n` : ''}\nRecommended Action: ${alert.recommended_action || 'Follow up with the user'}`;

        const noteResponse = await fetch('https://api.followupboss.com/v1/notes', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(apiKey + ':'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                personId,
                body: noteBody
            })
        });

        if (!noteResponse.ok) {
            const errorText = await noteResponse.text();
            console.log('Note creation failed (non-fatal):', errorText);
        }

        // Create a task in Follow Up Boss for today (all-day)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const taskDescription = `Follow up with ${alert.user_name || alert.user_email} regarding engagement drop.\n\n${alert.recommended_action || 'Reach out to re-engage this contact.'}`;

        const taskResponse = await fetch('https://api.followupboss.com/v1/tasks', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(apiKey + ':'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                personId,
                name: `Engagement Drop: Follow up with ${alert.user_name || alert.user_email}`,
                description: taskDescription,
                dueDate: today,
                isCompleted: false
            })
        });

        if (!taskResponse.ok) {
            const errText = await taskResponse.text();
            console.log('Task creation failed (non-fatal):', errText);
        }

        // Update alert status to indicate it was synced
        await base44.asServiceRole.entities.EngagementAlert.update(alert_id, {
            status: 'action_taken'
        });

        return Response.json({
            success: true,
            person_id: personData.id,
            message: 'Successfully synced to Follow Up Boss'
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});