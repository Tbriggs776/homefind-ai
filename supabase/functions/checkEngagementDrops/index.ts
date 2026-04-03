import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

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
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

        const [usersRes, viewsRes, propertiesRes] = await Promise.all([
            admin.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000),
            admin.from('property_views').select('*').order('created_at', { ascending: false }).limit(10000),
            admin.from('properties').select('*').order('created_at', { ascending: false }).limit(1000),
        ]);

        const allUsers = usersRes.data || [];
        const allViews = viewsRes.data || [];
        const allProperties = propertiesRes.data || [];

        let fubUsers = [];
        const fubUsersRes = await fetch('https://api.followupboss.com/v1/users', { headers: fubHeaders });
        if (fubUsersRes.ok) {
            const fubUsersData = await fubUsersRes.json();
            fubUsers = fubUsersData.users || fubUsersData || [];
        }

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

        let alertsCreated = 0;

        for (const u of allUsers) {
            if (u.role === 'admin' || u.is_user_admin === true) continue;

            const userViews = allViews.filter(v => v.user_id === u.id);
            if (userViews.length < 3) continue;

            const recentViews = userViews.filter(v => new Date(v.created_at) >= threeDaysAgo);
            const previousViews = userViews.filter(v => {
                const d = new Date(v.created_at);
                return d >= sixDaysAgo && d < threeDaysAgo;
            });

            const recentEngagement = recentViews.length;
            const previousEngagement = previousViews.length;

            if (previousEngagement <= 0) continue;

            const dropPercentage = ((previousEngagement - recentEngagement) / previousEngagement) * 100;

            if (dropPercentage >= 50) {
                const { data: existingAlerts } = await admin
                    .from('engagement_alerts')
                    .select('*')
                    .eq('user_id', u.id)
                    .eq('alert_type', 'engagement_drop')
                    .eq('status', 'new');

                const recentAlert = (existingAlerts || []).find(a => {
                    const alertAge = now.getTime() - new Date(a.created_at).getTime();
                    return alertAge < 3 * 24 * 60 * 60 * 1000;
                });

                if (recentAlert) continue;

                const viewedProperties = allProperties.filter(p =>
                    userViews.some(v => v.property_id === p.id)
                );

                const aiSummary = await generateEngagementSummary(u, recentEngagement, previousEngagement, viewedProperties);

                await admin.from('engagement_alerts').insert({
                    user_id: u.id,
                    user_email: u.email,
                    user_name: u.full_name || u.email,
                    alert_type: 'engagement_drop',
                    previous_engagement_score: previousEngagement,
                    current_engagement_score: recentEngagement,
                    drop_percentage: Math.round(dropPercentage),
                    ai_summary: aiSummary.summary,
                    recommended_action: aiSummary.action,
                    status: 'new',
                    last_activity_date: userViews[0]?.created_at || new Date().toISOString()
                });

                // Create FUB task assigned to the user admin
                await createFollowUpBossTask(u, dropPercentage, aiSummary, allUsers, fubUsers, fubHeaders, getFubPersonId);

                alertsCreated++;
            }

            if (recentEngagement > previousEngagement * 1.5 && recentEngagement >= 5) {
                const { data: existingHighInterest } = await admin
                    .from('engagement_alerts')
                    .select('*')
                    .eq('user_id', u.id)
                    .eq('alert_type', 'high_interest');

                const recentHighInterest = (existingHighInterest || []).find(a =>
                    now.getTime() - new Date(a.created_at).getTime() < 3 * 24 * 60 * 60 * 1000
                );

                if (!recentHighInterest) {
                    const highInterestSummary = {
                        summary: `${u.full_name || 'User'} is showing increased interest with ${recentEngagement} property views in the last 3 days, up from ${previousEngagement}.`,
                        action: 'Reach out with personalized property recommendations or schedule a showing.'
                    };

                    await admin.from('engagement_alerts').insert({
                        user_id: u.id,
                        user_email: u.email,
                        user_name: u.full_name || u.email,
                        alert_type: 'high_interest',
                        previous_engagement_score: previousEngagement,
                        current_engagement_score: recentEngagement,
                        drop_percentage: 0,
                        ai_summary: highInterestSummary.summary,
                        recommended_action: highInterestSummary.action,
                        status: 'new',
                        last_activity_date: userViews[0]?.created_at || new Date().toISOString()
                    });

                    // Create FUB task for high interest alert
                    const increasePct = Math.round(((recentEngagement - previousEngagement) / previousEngagement) * 100);
                    await createHighInterestFubTask(u, increasePct, highInterestSummary, allUsers, fubUsers, fubHeaders, getFubPersonId);

                    alertsCreated++;
                }
            }
        }

        return jsonResponse({
            success: true,
            alerts_created: alertsCreated,
            users_checked: allUsers.filter(u => u.role !== 'admin' && !u.is_user_admin).length,
            message: `Checked users over 3-day window and created ${alertsCreated} new alerts`
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message, stack: (error as Error).stack }, 500);
    }
});

async function generateEngagementSummary(user: any, recentEngagement: number, previousEngagement: number, viewedProperties: any[]) {
    try {
        const propertyTypes = [...new Set(viewedProperties.map(p => p.property_type))];
        const avgPrice = viewedProperties.length > 0
            ? Math.round(viewedProperties.reduce((sum, p) => sum + (p.price || 0), 0) / viewedProperties.length)
            : 0;
        const cities = [...new Set(viewedProperties.map(p => p.city).filter(Boolean))];

        const dropPct = Math.round(((previousEngagement - recentEngagement) / previousEngagement) * 100);

        const prompt = `Real estate client ${user.full_name || user.email} has shown a ${dropPct}% drop in property search activity over 3 days.

Previous 3 days: ${previousEngagement} property views
Last 3 days: ${recentEngagement} property views
Property types they searched: ${propertyTypes.join(', ') || 'N/A'}
Average price range: $${avgPrice.toLocaleString()}
Cities of interest: ${cities.join(', ') || 'N/A'}

Provide:
1) A brief 1-sentence summary of why they might have disengaged
2) One specific action the agent should take to re-engage them

Keep it under 80 words total. Be professional and actionable.`;

        if (!openaiApiKey) {
            return {
                summary: `${user.full_name || 'Client'} has shown a ${dropPct}% drop in engagement over the past 3 days.`,
                action: 'Schedule a follow-up call to understand their needs and re-engage.'
            };
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
                    { role: "system", content: "You are a real estate CRM assistant helping agents re-engage clients." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 150
            })
        });

        if (!response.ok) return {
            summary: `${user.full_name || 'Client'} has shown a ${dropPct}% drop in search activity over the last 3 days.`,
            action: 'Schedule a follow-up call to understand their needs and re-engage.'
        };

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const lines = text.split('\n').filter((l: string) => l.trim());
        return {
            summary: lines[0] || `${user.full_name || 'Client'} has shown a ${dropPct}% drop in engagement over the past 3 days.`,
            action: lines[1] || 'Schedule a follow-up call to understand their needs and re-engage.'
        };
    } catch (error) {
        const dropPct = Math.round(((previousEngagement - recentEngagement) / previousEngagement) * 100);
        return {
            summary: `${user.full_name || 'Client'} has shown a ${dropPct}% drop in search activity over the last 3 days.`,
            action: 'Schedule a follow-up call to understand their needs and re-engage.'
        };
    }
}

async function createFollowUpBossTask(customer: any, dropPercentage: number, aiSummary: any, allUsers: any[], fubUsers: any[], fubHeaders: Record<string, string>, getFubPersonId: (email: string) => Promise<string | null>) {
    try {
        const userAdminEmail = customer.invited_by;
        let assignedToFubUserId = null;

        if (userAdminEmail) {
            const fubUserAdmin = fubUsers.find((u: any) =>
                u.email?.toLowerCase().trim() === userAdminEmail.toLowerCase().trim()
            );
            if (fubUserAdmin) assignedToFubUserId = fubUserAdmin.id;
        }

        const personId = await getFubPersonId(customer.email);

        const taskBody: any = {
            description: `🔔 Follow up with ${customer.full_name || customer.email} — ${Math.round(dropPercentage)}% drop in search activity over 3 days.\n\n${aiSummary.summary}\n\n💡 ${aiSummary.action}`,
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            ...(personId && { personId }),
            ...(assignedToFubUserId && { assignedTo: assignedToFubUserId })
        };

        const res = await fetch('https://api.followupboss.com/v1/tasks', {
            method: 'POST',
            headers: fubHeaders,
            body: JSON.stringify(taskBody)
        });

        if (res.ok) {
            console.log(`Created FUB task for ${customer.email}, assigned to admin: ${userAdminEmail || 'unassigned'}`);
        } else {
            console.error(`Failed to create FUB task for ${customer.email}:`, await res.text());
        }
    } catch (error) {
        console.error('Error creating FUB task:', error);
    }
}

async function createHighInterestFubTask(customer: any, increasePct: number, aiSummary: any, allUsers: any[], fubUsers: any[], fubHeaders: Record<string, string>, getFubPersonId: (email: string) => Promise<string | null>) {
    try {
        const userAdminEmail = customer.invited_by;
        let assignedToFubUserId = null;

        if (userAdminEmail) {
            const fubUserAdmin = fubUsers.find((u: any) =>
                u.email?.toLowerCase().trim() === userAdminEmail.toLowerCase().trim()
            );
            if (fubUserAdmin) assignedToFubUserId = fubUserAdmin.id;
        }

        const personId = await getFubPersonId(customer.email);

        const taskBody: any = {
            description: `🔥 ${customer.full_name || customer.email} is showing HIGH INTEREST — ${increasePct}% increase in search activity over 3 days.\n\n${aiSummary.summary}\n\n💡 ${aiSummary.action}`,
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            ...(personId && { personId }),
            ...(assignedToFubUserId && { assignedTo: assignedToFubUserId })
        };

        const res = await fetch('https://api.followupboss.com/v1/tasks', {
            method: 'POST',
            headers: fubHeaders,
            body: JSON.stringify(taskBody)
        });

        if (res.ok) {
            console.log(`Created FUB high-interest task for ${customer.email}, assigned to: ${userAdminEmail || 'unassigned'}`);
        } else {
            console.error(`Failed to create FUB high-interest task for ${customer.email}:`, await res.text());
        }
    } catch (error) {
        console.error('Error creating FUB high-interest task:', error);
    }
}
