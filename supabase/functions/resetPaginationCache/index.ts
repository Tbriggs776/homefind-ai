import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user?.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        const { data: paginationCache } = await admin
            .from('sync_cache')
            .select('*')
            .eq('sync_key', 'spark_api_pagination');

        if (paginationCache && paginationCache.length > 0) {
            await admin
                .from('sync_cache')
                .update({
                    cached_data: { offset: 0, lastRun: new Date().toISOString() }
                })
                .eq('id', paginationCache[0].id);

            return jsonResponse({
                success: true,
                message: 'Pagination cache reset to offset 0',
                previous_offset: paginationCache[0].cached_data?.offset || 0
            });
        }

        return jsonResponse({
            success: true,
            message: 'No pagination cache found'
        });

    } catch (error) {
        return jsonResponse({
            error: (error as Error).message,
            stack: (error as Error).stack
        }, 500);
    }
});
