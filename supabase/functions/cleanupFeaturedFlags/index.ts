import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);
        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const PAUL_MLS_ID = 'pc295';
        let fixed = 0;
        let checked = 0;

        const { data: featured } = await admin
            .from('properties')
            .select('*')
            .eq('is_featured', true)
            .order('created_at', { ascending: false })
            .limit(500);

        if (!featured) {
            return jsonResponse({
                success: true,
                total_checked: 0,
                fixed: 0,
                message: 'No featured properties found'
            });
        }

        checked = featured.length;
        const toFix = featured.filter(p => p.list_agent_mls_id !== PAUL_MLS_ID);

        const fixBatch = toFix.slice(0, 50);
        for (const p of fixBatch) {
            await admin
                .from('properties')
                .update({ is_featured: false })
                .eq('id', p.id);
            fixed++;
            await new Promise(r => setTimeout(r, 200));
        }

        return jsonResponse({
            success: true,
            total_checked: checked,
            fixed: fixed,
            message: `Cleared is_featured on ${fixed} non-Paul properties`
        });

    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
