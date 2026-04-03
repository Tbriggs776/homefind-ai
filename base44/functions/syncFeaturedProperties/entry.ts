import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// ── Strategy ──────────────────────────────────────────────────────────────────
// The Spark replication API does NOT support filtering by ListAgentMlsId.
// Instead, this function scans our local database for properties where
// list_agent_mls_id matches Paul Crandell's ID ('pc295') and marks them
// as is_featured=true. It also un-features any property that was
// incorrectly marked.
// ──────────────────────────────────────────────────────────────────────────────

const AGENT_MLS_ID = 'pc295';
const CURSOR_KEY = 'featured_sync_cursor';
const BATCH_SIZE = 50;

Deno.serve(async (req) => {
    const startTime = Date.now();

    try {
        const base44 = createClientFromRequest(req);

        // Allow scheduled automations or admin manual triggers
        try {
            const user = await base44.auth.me();
            if (user && user.role !== 'admin') {
                return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (_) {
            // No user = scheduled automation
        }

        let markedFeatured = 0;
        let unmarkedFeatured = 0;

        // Step 1: Find properties with agent pc295 that are NOT featured yet
        const unfeaturedAgentProps = await base44.asServiceRole.entities.Property.filter(
            { list_agent_mls_id: AGENT_MLS_ID, is_featured: false },
            '-created_date',
            100
        );
        
        // Also check for null/undefined is_featured with this agent
        const allAgentProps = await base44.asServiceRole.entities.Property.filter(
            { list_agent_mls_id: AGENT_MLS_ID },
            '-created_date',
            200
        );
        
        const needsFeatured = allAgentProps.filter(p => !p.is_featured);
        
        for (const prop of needsFeatured) {
            if (Date.now() - startTime > 20000) break;
            await base44.asServiceRole.entities.Property.update(prop.id, { is_featured: true });
            markedFeatured++;
        }

        console.log(`Marked ${markedFeatured} properties as featured for agent ${AGENT_MLS_ID}`);

        // Step 2: Find properties marked as featured that do NOT belong to pc295
        const wronglyFeatured = await base44.asServiceRole.entities.Property.filter(
            { is_featured: true },
            '-created_date',
            200
        );

        const toUnfeature = wronglyFeatured.filter(p => {
            const agentId = (p.list_agent_mls_id || '').toLowerCase();
            return agentId !== AGENT_MLS_ID.toLowerCase();
        });

        for (const prop of toUnfeature) {
            if (Date.now() - startTime > 25000) break;
            await base44.asServiceRole.entities.Property.update(prop.id, { is_featured: false });
            unmarkedFeatured++;
        }

        console.log(`Unmarked ${unmarkedFeatured} incorrectly featured properties`);

        // Step 3: Save sync result
        const cursorArr = await base44.asServiceRole.entities.SyncCache.filter({ sync_key: CURSOR_KEY });
        const cursorData = {
            sync_key: CURSOR_KEY,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            total_fetched: allAgentProps.length,
            new_items: markedFeatured,
            updated_items: unmarkedFeatured,
            cached_data: {
                agent: AGENT_MLS_ID,
                total_agent_listings: allAgentProps.length,
                newly_featured: markedFeatured,
                unfeatured_wrong: unmarkedFeatured
            }
        };
        if (cursorArr.length > 0) {
            await base44.asServiceRole.entities.SyncCache.update(cursorArr[0].id, cursorData);
        } else {
            await base44.asServiceRole.entities.SyncCache.create(cursorData);
        }

        return Response.json({
            success: true,
            agent: AGENT_MLS_ID,
            total_agent_listings_in_db: allAgentProps.length,
            newly_marked_featured: markedFeatured,
            incorrectly_featured_removed: unmarkedFeatured,
            remaining_featured: allAgentProps.filter(p => p.is_featured).length + markedFeatured
        });

    } catch (error) {
        console.error('syncFeaturedProperties error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});