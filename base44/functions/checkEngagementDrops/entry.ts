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

        const now = new Date();
        // Compare last 3 days vs previous 3 days
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

        const [allUsers, allViews, allProperties] = await Promise.all([
            base44.asServiceRole.entities.User.list('-created_date', 1000),
            base44.asServiceRole.entities.PropertyView.list('-created_date', 10000),
            base44.asServiceRole.entities.Property.list('-created_date', 1000)
        ]);

        // Get FUB users list once (to resolve user admin FUB IDs)
        let fubUsers = [];
        const fubUsersRes = await fetch('https://api.followupboss.com/v1/users', { headers: fubHeaders });
        if (fubUsersRes.ok) {
            const fubUsersData = await fubUsersRes.json();
            fubUsers = fubUsersData.users || fubUsersData || [];
        }

        // Cache FUB person IDs
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

        let alertsCreated = 0;

        for (const u of allUsers) {
            // Skip admin and user admin accounts
            if (u.role === 'admin' || u.is_user_admin === true) continue;

            const userViews = allViews.filter(v => v.user_email === u.email);
            if (userViews.length < 3) continue; // Need baseline activity

            // Last 3 days vs previous 3 days
            const recentViews = userViews.filter(v => new Date(v.created_date) >= threeDaysAgo);
            const previousViews = userViews.filter(v => {
                const d = new Date(v.created_date);
                return d >= sixDaysAgo && d < threeDaysAgo;
            });

            const recentEngagement = recentViews.length;
            const previousEngagement = previousViews.length;

            if (previousEngagement <= 0) continue;

            const dropPercentage = ((previousEngagement - recentEngagement) / previousEngagement) * 100;

            if (dropPercentage >= 50) {
                // Check if we already have a recent (last 3 days) alert for this user
                const existingAlerts = await base44.asServiceRole.entities.EngagementAlert.filter({
                    user_email: u.email,
                    alert_type: 'engagement_drop',
                    status: 'new'
                });

                const recentAlert = existingAlerts.find(a => {
                    const alertAge = now - new Date(a.created_date);
                    return alertAge < 3 * 24 * 60 * 60 * 1000;
                });

                if (recentAlert) continue;

                const viewedProperties = allProperties.filter(p =>
                    userViews.some(v => v.property_id === p.id)
                );

                const aiSummary = await generateEngagementSummary(u, recentEngagement, previousEngagement, viewedProperties);

                // Create engagement alert in our DB
                await base44.asServiceRole.entities.EngagementAlert.create({
                    user_email: u.email,
                    user_name: u.full_name || u.email,
                    alert_type: 'engagement_drop',
                    previous_engagement_score: previousEngagement,
                    current_engagement_score: recentEngagement,
                    drop_percentage: Math.round(dropPercentage),
                    ai_summary: aiSummary.summary,
                    recommended_action: aiSummary.action,
                    status: 'new',
                    last_activity_date: userViews[0]?.created_date || new Date().toISOString().split('T')[0]
                });

                // Create FUB task assigned to the user admin
                await createFollowUpBossTask(u, dropPercentage, aiSummary, allUsers, fubUsers, fubHeaders, getFubPersonId);

                alertsCreated++;
            }

            // High interest alert (50% increase, at least 5 views in last 3 days)
            if (recentEngagement > previousEngagement * 1.5 && recentEngagement >= 5) {
                const existingHighInterest = await base44.asServiceRole.entities.EngagementAlert.filter({
                    user_email: u.email,
                    alert_type: 'high_interest'
                });

                const recentHighInterest = existingHighInterest.find(a =>
                    now - new Date(a.created_date) < 3 * 24 * 60 * 60 * 1000
                );

                if (!recentHighInterest) {
                    const highInterestSummary = {
                        summary: `${u.full_name || 'User'} is showing increased interest with ${recentEngagement} property views in the last 3 days, up from ${previousEngagement}.`,
                        action: 'Reach out with personalized property recommendations or schedule a showing.'
                    };

                    await base44.asServiceRole.entities.EngagementAlert.create({
                        user_email: u.email,
                        user_name: u.full_name || u.email,
                        alert_type: 'high_interest',
                        previous_engagement_score: previousEngagement,
                        current_engagement_score: recentEngagement,
                        drop_percentage: 0,
                        ai_summary: highInterestSummary.summary,
                        recommended_action: highInterestSummary.action,
                        status: 'new',
                        last_activity_date: userViews[0]?.created_date || new Date().toISOString().split('T')[0]
                    });

                    // Create FUB task for high interest alert too
                    const increasePct = Math.round(((recentEngagement - previousEngagement) / previousEngagement) * 100);
                    await createHighInterestFubTask(u, increasePct, highInterestSummary, allUsers, fubUsers, fubHeaders, getFubPersonId);

                    alertsCreated++;
                }
            }
        }

        return Response.json({
            success: true,
            alerts_created: alertsCreated,
            users_checked: allUsers.filter(u => u.role !== 'admin' && !u.is_user_admin).length,
            message: `Checked users over 3-day window and created ${alertsCreated} new alerts`
        });

    } catch (error) {
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});

async function createFollowUpBossTask(customer, dropPercentage, aiSummary, allUsers, fubUsers, fubHeaders, getFubPersonId) {
    try {
        // Resolve the user admin this customer belongs to
        const userAdminEmail = customer.invited_by;
        let assignedToFubUserId = null;

        if (userAdminEmail) {
            const fubUserAdmin = fubUsers.find(u =>
                u.email?.toLowerCase().trim() === userAdminEmail.toLowerCase().trim()
            );
            if (fubUserAdmin) assignedToFubUserId = fubUserAdmin.id;
        }

        // Get customer's FUB person ID
        const personId = await getFubPersonId(customer.email);

        const taskBody = {
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

async function createHighInterestFubTask(customer, increasePct, aiSummary, allUsers, fubUsers, fubHeaders, getFubPersonId) {
    try {
        const userAdminEmail = customer.invited_by;
        let assignedToFubUserId = null;

        if (userAdminEmail) {
            const fubUserAdmin = fubUsers.find(u =>
                u.email?.toLowerCase().trim() === userAdminEmail.toLowerCase().trim()
            );
            if (fubUserAdmin) assignedToFubUserId = fubUserAdmin.id;
        }

        const personId = await getFubPersonId(customer.email);

        const taskBody = {
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

async function generateEngagementSummary(user, recentEngagement, previousEngagement, viewedProperties) {
    try {
        const propertyTypes = [...new Set(viewedProperties.map(p => p.property_type))];
        const avgPrice = viewedProperties.length > 0
            ? Math.round(viewedProperties.reduce((sum, p) => sum + p.price, 0) / viewedProperties.length)
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

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a real estate CRM assistant helping agents re-engage clients." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 150
        });

        const text = response.choices[0].message.content;
        const lines = text.split('\n').filter(l => l.trim());
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