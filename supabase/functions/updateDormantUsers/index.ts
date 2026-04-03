import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { data: allUsers } = await admin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10000);

        if (!allUsers) {
            return jsonResponse({ success: true, dormantCount: 0, message: 'No users found' });
        }

        const activeUsers = allUsers.filter(u => u.status === 'active' && u.last_activity_date);

        let dormantCount = 0;
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        for (const u of activeUsers) {
            const lastActivity = new Date(u.last_activity_date);
            if (lastActivity < thirtyDaysAgo) {
                await admin
                    .from('profiles')
                    .update({ status: 'dormant' })
                    .eq('id', u.id);
                dormantCount++;
            }
        }

        return jsonResponse({
            success: true,
            dormantCount,
            message: `Updated ${dormantCount} users to dormant status`
        });
    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
