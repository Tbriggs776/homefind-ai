import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// One-time cleanup: removes is_featured from properties not belonging to Paul Crandell (pc295)

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const PAUL_MLS_ID = 'pc295';
        let fixed = 0;
        let checked = 0;
        const BATCH = 50;
        const MAX_FIXES = 200; // Process up to 200 per run to avoid timeout

        const featured = await base44.asServiceRole.entities.Property.filter(
            { is_featured: true },
            '-created_date',
            500
        );

        checked = featured.length;
        const toFix = featured.filter(p => p.list_agent_mls_id !== PAUL_MLS_ID);
        const paulsCount = featured.length - toFix.length;

        // Fix one at a time with delays to avoid rate limits
        const fixBatch = toFix.slice(0, 50);
        for (const p of fixBatch) {
            await base44.asServiceRole.entities.Property.update(p.id, { is_featured: false });
            fixed++;
            await new Promise(r => setTimeout(r, 200));
        }

        return Response.json({
            success: true,
            total_checked: checked,
            fixed: fixed,
            message: `Cleared is_featured on ${fixed} non-Paul properties`
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});