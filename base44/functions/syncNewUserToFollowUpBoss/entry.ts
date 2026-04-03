import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const apiKey = Deno.env.get("FOLLOW_UP_BOSS_API_KEY");
        if (!apiKey) return Response.json({ error: 'Follow Up Boss API key not configured' }, { status: 500 });

        // Support both direct call (with user context) and entity automation (with payload)
        let email, fullName;

        const body = await req.json().catch(() => ({}));

        if (body?.event?.entity_name === 'User' || body?.data?.email) {
            // Called from entity automation
            const userData = body.data || {};
            email = userData.email;
            fullName = userData.full_name || '';
        } else {
            // Called directly from frontend (authenticated user)
            const user = await base44.auth.me();
            if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
            email = user.email;
            fullName = user.full_name || '';
        }

        if (!email) return Response.json({ error: 'No email provided' }, { status: 400 });

        const fubHeaders = {
            'Authorization': `Basic ${btoa(apiKey + ':')}`,
            'Content-Type': 'application/json'
        };

        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0] || email.split('@')[0];
        const lastName = nameParts.slice(1).join(' ') || '';

        // Check if person already exists in Follow Up Boss
        const searchResponse = await fetch(
            `https://api.followupboss.com/v1/people?email=${encodeURIComponent(email)}&limit=1`,
            { method: 'GET', headers: fubHeaders }
        );

        let existingPersonId = null;
        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const people = searchData.people || searchData._embedded?.people || [];
            if (people.length > 0) {
                existingPersonId = people[0].id;
            }
        }

        const personPayload = {
            firstName,
            ...(lastName && { lastName }),
            emails: [{ value: email }],
            source: 'Crandell Home Intelligence'
        };

        let personId;

        if (existingPersonId) {
            // Update existing contact
            const updateResponse = await fetch(`https://api.followupboss.com/v1/people/${existingPersonId}`, {
                method: 'PUT',
                headers: fubHeaders,
                body: JSON.stringify(personPayload)
            });

            if (!updateResponse.ok) {
                const errText = await updateResponse.text();
                return Response.json({ error: 'Failed to update contact in Follow Up Boss', details: errText }, { status: 500 });
            }

            personId = existingPersonId;
            return Response.json({ success: true, message: 'Contact updated in Follow Up Boss', person_id: personId, action: 'updated' });
        } else {
            // Create new contact
            const createResponse = await fetch('https://api.followupboss.com/v1/people', {
                method: 'POST',
                headers: fubHeaders,
                body: JSON.stringify(personPayload)
            });

            if (!createResponse.ok) {
                const errText = await createResponse.text();
                return Response.json({ error: 'Failed to create contact in Follow Up Boss', details: errText }, { status: 500 });
            }

            const data = await createResponse.json();
            personId = data.id || data.person?.id;
            return Response.json({ success: true, message: 'Contact created in Follow Up Boss', person_id: personId, action: 'created' });
        }

    } catch (error) {
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});