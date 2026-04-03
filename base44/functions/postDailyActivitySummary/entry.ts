import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai';

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow scheduled runs (no user) or admin manual triggers
        const user = await base44.auth.me().catch(() => null);
        if (user && user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const apiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
        if (!apiKey) return Response.json({ error: 'FOLLOW_UP_BOSS_API_KEY not configured' }, { status: 500 });

        const fubHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${btoa(apiKey + ':')}`
        };

        // Get today's date range
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

        // Fetch all data needed
        const [allViews, allUsers, allProperties, allSavedProperties] = await Promise.all([
            base44.asServiceRole.entities.PropertyView.list('-created_date', 10000),
            base44.asServiceRole.entities.User.list('-created_date', 1000),
            base44.asServiceRole.entities.Property.list('-created_date', 1000),
            base44.asServiceRole.entities.SavedProperty.list('-created_date', 1000)
        ]);

        // Filter today's views
        const todayViews = allViews.filter(v => {
            const d = new Date(v.created_date);
            return d >= startOfToday && d < endOfToday;
        });

        // Group views by user
        const userActivity = {};
        todayViews.forEach(view => {
            if (!userActivity[view.user_email]) userActivity[view.user_email] = [];
            userActivity[view.user_email].push(view);
        });

        // Cache FUB person IDs to avoid repeated lookups
        const fubPersonIdCache = {};
        const getFubPersonId = async (email) => {
            if (fubPersonIdCache[email]) return fubPersonIdCache[email];
            const res = await fetch(`https://api.followupboss.com/v1/people?email=${encodeURIComponent(email)}&limit=1`, { headers: fubHeaders });
            if (!res.ok) return null;
            const data = await res.json();
            const people = data.people || data._embedded?.people || data.data || [];
            const personId = people[0]?.id || null;
            if (personId) fubPersonIdCache[email] = personId;
            return personId;
        };

        let notesPosted = 0;
        let emailsSent = 0;
        const activeUserEmails = Object.keys(userActivity);

        for (const email of activeUserEmails) {
            const views = userActivity[email];
            const userObj = allUsers.find(u => u.email === email);
            if (!userObj || userObj.role === 'admin' || userObj.is_user_admin === true) continue;

            const viewedProperties = allProperties.filter(p => views.some(v => v.property_id === p.id));
            const savedToday = allSavedProperties.filter(sp => {
                const d = new Date(sp.created_date);
                return sp.user_email === email && d >= startOfToday && d < endOfToday;
            });

            const summary = await generateDailySummary(userObj, views, viewedProperties, savedToday);
            const noteBody = `📊 Daily Activity Summary - ${now.toLocaleDateString()}\n\n${summary}`;

            // Look up FUB person ID by email, auto-create if missing
            let personId = await getFubPersonId(email);
            if (!personId) {
                console.log(`No FUB person found for ${email}, creating contact...`);
                const nameParts = (userObj.full_name || email.split('@')[0]).trim().split(' ');
                const createRes = await fetch('https://api.followupboss.com/v1/people', {
                    method: 'POST',
                    headers: fubHeaders,
                    body: JSON.stringify({
                        firstName: nameParts[0] || '',
                        lastName: nameParts.slice(1).join(' ') || '',
                        emails: [{ value: email }],
                        source: 'Crandell Home Intelligence'
                    })
                });
                if (createRes.ok) {
                    const createData = await createRes.json();
                    personId = createData.id || createData.person?.id;
                    if (personId) fubPersonIdCache[email] = personId;
                    console.log(`Created FUB contact for ${email} (personId: ${personId})`);
                } else {
                    console.error(`Failed to create FUB contact for ${email}:`, await createRes.text());
                    continue;
                }
            }

            // Post note to FUB using correct /v1/notes endpoint with personId
            const noteRes = await fetch('https://api.followupboss.com/v1/notes', {
                method: 'POST',
                headers: fubHeaders,
                body: JSON.stringify({ personId, body: noteBody })
            });

            if (noteRes.ok) {
                notesPosted++;
                console.log(`Posted daily note for ${email} (personId: ${personId})`);
            } else {
                console.error(`Failed to post note for ${email}:`, await noteRes.text());
            }

            // Send email to the user admin this customer is associated with
            const userAdminEmail = userObj.invited_by;
            if (userAdminEmail) {
                const userAdminObj = allUsers.find(u => u.email === userAdminEmail);
                const customerName = userObj.full_name || email;
                const adminName = userAdminObj?.full_name || userAdminEmail;

                try {
                    await base44.asServiceRole.integrations.Core.SendEmail({
                        to: userAdminEmail,
                        from_name: 'Crandell Home Intelligence',
                        subject: `Daily Activity Report: ${customerName} — ${now.toLocaleDateString()}`,
                        body: `Hi ${adminName},\n\nHere is today's property search activity summary for your client ${customerName}:\n\n${summary}\n\n—\nCrandell Home Intelligence`
                    });
                    emailsSent++;
                    console.log(`Sent daily summary email to user admin ${userAdminEmail} for client ${email}`);
                } catch (emailErr) {
                    console.error(`Failed to send email to ${userAdminEmail}:`, emailErr.message);
                }
            }
        }

        return Response.json({
            success: true,
            active_users: activeUserEmails.length,
            notes_posted: notesPosted,
            emails_sent: emailsSent,
            message: `Posted ${notesPosted} FUB notes and sent ${emailsSent} emails to user admins`
        });

    } catch (error) {
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});

async function generateDailySummary(user, views, viewedProperties, savedProperties) {
    try {
        const totalViews = views.length;
        const uniqueProperties = [...new Set(views.map(v => v.property_id))].length;
        const favorites = views.filter(v => v.interaction_type === 'favorite').length;
        const propertyTypes = [...new Set(viewedProperties.map(p => p.property_type))];
        const cities = [...new Set(viewedProperties.map(p => p.city).filter(Boolean))];
        const priceRange = viewedProperties.length > 0 ? {
            min: Math.min(...viewedProperties.map(p => p.price)),
            max: Math.max(...viewedProperties.map(p => p.price)),
            avg: Math.round(viewedProperties.reduce((sum, p) => sum + p.price, 0) / viewedProperties.length)
        } : null;

        const prompt = `Create a concise daily activity summary for real estate client ${user.full_name || user.email}:

Activity Today:
- Total property views: ${totalViews}
- Unique properties viewed: ${uniqueProperties}
- Properties saved: ${savedProperties.length}
- Favorites marked: ${favorites}
- Property types viewed: ${propertyTypes.join(', ') || 'N/A'}
- Cities of interest: ${cities.join(', ') || 'N/A'}
${priceRange ? `- Price range viewed: $${priceRange.min.toLocaleString()} - $${priceRange.max.toLocaleString()} (avg: $${priceRange.avg.toLocaleString()})` : ''}

Write a professional 3-4 sentence summary highlighting their activity level, key property preferences, and one actionable insight for their agent. Keep it concise and actionable.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a real estate CRM assistant creating daily activity summaries for agents." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 200
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error generating AI summary:', error);
        return `${user.full_name || user.email} was active today with ${views.length} property views across ${[...new Set(views.map(v => v.property_id))].length} unique properties.${savedProperties.length > 0 ? ` They saved ${savedProperties.length} properties.` : ''} Consider following up to discuss their property search.`;
    }
}