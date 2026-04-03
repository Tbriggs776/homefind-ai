import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

async function generateDailySummary(user: any, views: any[], viewedProperties: any[], savedProperties: any[]) {
    try {
        const totalViews = views.length;
        const uniqueProperties = [...new Set(views.map(v => v.property_id))].length;
        const favorites = views.filter(v => v.interaction_type === 'favorite').length;
        const propertyTypes = [...new Set(viewedProperties.map(p => p.property_type))];
        const cities = [...new Set(viewedProperties.map(p => p.city).filter(Boolean))];
        const priceRange = viewedProperties.length > 0 ? {
            min: Math.min(...viewedProperties.map(p => p.price || 0)),
            max: Math.max(...viewedProperties.map(p => p.price || 0)),
            avg: Math.round(viewedProperties.reduce((sum, p) => sum + (p.price || 0), 0) / viewedProperties.length)
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

        if (!openaiApiKey) {
            return `${user.full_name || user.email} was active today with ${views.length} property views across ${uniqueProperties} unique properties.${savedProperties.length > 0 ? ` They saved ${savedProperties.length} properties.` : ''} Consider following up to discuss their property search.`;
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are a real estate CRM assistant creating daily activity summaries for agents." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 200
            })
        });

        if (!response.ok) {
            return `${user.full_name || user.email} was active today with ${views.length} property views across ${uniqueProperties} unique properties.`;
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || `${user.full_name || user.email} was active today with ${views.length} property views across ${uniqueProperties} unique properties.`;
    } catch (error) {
        const uniqueProperties = [...new Set(views.map(v => v.property_id))].length;
        return `${user.full_name || user.email} was active today with ${views.length} property views across ${uniqueProperties} unique properties.${savedProperties.length > 0 ? ` They saved ${savedProperties.length} properties.` : ''} Consider following up to discuss their property search.`;
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user && user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const apiKey = Deno.env.get('FOLLOW_UP_BOSS_API_KEY');
        if (!apiKey) return jsonResponse({ error: 'FOLLOW_UP_BOSS_API_KEY not configured' }, 500);

        const fubHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${btoa(apiKey + ':')}`
        };

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

        const [viewsRes, usersRes, propertiesRes, savedPropsRes] = await Promise.all([
            admin.from('property_views').select('*').order('created_at', { ascending: false }).limit(10000),
            admin.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000),
            admin.from('properties').select('*').order('created_at', { ascending: false }).limit(1000),
            admin.from('saved_properties').select('*').order('created_at', { ascending: false }).limit(1000),
        ]);

        const allViews = viewsRes.data || [];
        const allUsers = usersRes.data || [];
        const allProperties = propertiesRes.data || [];
        const allSavedProperties = savedPropsRes.data || [];

        const todayViews = allViews.filter(v => {
            const d = new Date(v.created_at);
            return d >= startOfToday && d < endOfToday;
        });

        const userActivity: Record<string, any[]> = {};
        todayViews.forEach(view => {
            if (!userActivity[view.user_id]) userActivity[view.user_id] = [];
            userActivity[view.user_id].push(view);
        });

        const fubPersonIdCache: Record<string, string | null> = {};
        const getFubPersonId = async (email: string) => {
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
        const activeUserIds = Object.keys(userActivity);

        for (const userId of activeUserIds) {
            const views = userActivity[userId];
            const userObj = allUsers.find(u => u.id === userId);
            if (!userObj || userObj.role === 'admin' || userObj.is_user_admin === true) continue;

            const viewedProperties = allProperties.filter(p => views.some(v => v.property_id === p.id));
            const savedToday = allSavedProperties.filter(sp => {
                const d = new Date(sp.created_at);
                return sp.user_id === userId && d >= startOfToday && d < endOfToday;
            });

            const summary = await generateDailySummary(userObj, views, viewedProperties, savedToday);
            const noteBody = `📊 Daily Activity Summary - ${now.toLocaleDateString()}\n\n${summary}`;

            let personId = await getFubPersonId(userObj.email);
            if (!personId) {
                console.log(`No FUB person found for ${userObj.email}, creating contact...`);
                const nameParts = (userObj.full_name || userObj.email.split('@')[0]).trim().split(' ');
                const createRes = await fetch('https://api.followupboss.com/v1/people', {
                    method: 'POST',
                    headers: fubHeaders,
                    body: JSON.stringify({
                        firstName: nameParts[0] || '',
                        lastName: nameParts.slice(1).join(' ') || '',
                        emails: [{ value: userObj.email }],
                        source: 'Crandell Home Intelligence'
                    })
                });
                if (createRes.ok) {
                    const createData = await createRes.json();
                    personId = createData.id || createData.person?.id;
                    if (personId) fubPersonIdCache[userObj.email] = personId;
                    console.log(`Created FUB contact for ${userObj.email} (personId: ${personId})`);
                } else {
                    console.error(`Failed to create FUB contact for ${userObj.email}:`, await createRes.text());
                    continue;
                }
            }

            const noteRes = await fetch('https://api.followupboss.com/v1/notes', {
                method: 'POST',
                headers: fubHeaders,
                body: JSON.stringify({ personId, body: noteBody })
            });

            if (noteRes.ok) {
                notesPosted++;
                console.log(`Posted daily note for ${userObj.email} (personId: ${personId})`);
            } else {
                console.error(`Failed to post note for ${userObj.email}:`, await noteRes.text());
            }

            // Send email to the user admin this customer is associated with
            const userAdminEmail = userObj.invited_by;
            if (userAdminEmail) {
                const resendApiKey = Deno.env.get('RESEND_API_KEY');
                if (resendApiKey) {
                    const userAdminObj = allUsers.find(u => u.email === userAdminEmail);
                    const customerName = userObj.full_name || userObj.email;
                    const adminName = userAdminObj?.full_name || userAdminEmail;

                    try {
                        const emailRes = await fetch('https://api.resend.com/emails', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${resendApiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                from: 'Crandell Home Intelligence <noreply@crandellhomeintelligence.com>',
                                to: [userAdminEmail],
                                subject: `Daily Activity Report: ${customerName} — ${now.toLocaleDateString()}`,
                                html: `<p>Hi ${adminName},</p><p>Here is today's property search activity summary for your client ${customerName}:</p><p>${summary}</p><p>—<br/>Crandell Home Intelligence</p>`
                            })
                        });
                        if (emailRes.ok) {
                            emailsSent++;
                            console.log(`Sent daily summary email to user admin ${userAdminEmail} for client ${userObj.email}`);
                        }
                    } catch (emailErr) {
                        console.error(`Failed to send email to ${userAdminEmail}:`, (emailErr as Error).message);
                    }
                }
            }
        }

        return jsonResponse({
            success: true,
            active_users: activeUserIds.length,
            notes_posted: notesPosted,
            emails_sent: emailsSent,
            message: `Posted ${notesPosted} FUB notes and sent ${emailsSent} emails to user admins`
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message, stack: (error as Error).stack }, 500);
    }
});
