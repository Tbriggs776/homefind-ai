import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Get all active users
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 10000);
        const activeUsers = allUsers.filter(u => u.status === 'active' && u.last_activity_date);

        let dormantCount = 0;
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // Check each active user for inactivity
        for (const u of activeUsers) {
            const lastActivity = new Date(u.last_activity_date);
            if (lastActivity < thirtyDaysAgo) {
                await base44.asServiceRole.entities.User.update(u.id, { status: 'dormant' });
                dormantCount++;
            }
        }

        return Response.json({ 
            success: true, 
            dormantCount,
            message: `Updated ${dormantCount} users to dormant status`
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});