import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Reset pagination cache to start from beginning
        const paginationCache = await base44.asServiceRole.entities.SyncCache.filter({ 
            sync_key: 'spark_api_pagination' 
        });
        
        if (paginationCache.length > 0) {
            await base44.asServiceRole.entities.SyncCache.update(paginationCache[0].id, {
                cached_data: { offset: 0, lastRun: new Date().toISOString() }
            });
            
            return Response.json({
                success: true,
                message: 'Pagination cache reset to offset 0',
                previous_offset: paginationCache[0].cached_data?.offset || 0
            });
        }

        return Response.json({
            success: true,
            message: 'No pagination cache found'
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});