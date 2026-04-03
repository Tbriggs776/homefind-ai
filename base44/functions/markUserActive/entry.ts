import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Mark user as active if not already
        if (user.status !== 'active') {
            await base44.auth.updateMe({ 
                status: 'active',
                last_activity_date: new Date().toISOString()
            });
        } else {
            // Just update last activity
            await base44.auth.updateMe({ 
                last_activity_date: new Date().toISOString()
            });
        }

        return Response.json({ success: true });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});