import { getServiceClient, getUser, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const AGENT_MLS_ID = 'pc295';
const CURSOR_KEY = 'featured_sync_cursor';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startTime = Date.now();

    try {
        const admin = getServiceClient();
        const user = await getUser(req);

        if (user && user.role !== 'admin') {
            return jsonResponse({ error: 'Forbidden: Admin access required' }, 403);
        }

        let markedFeatured = 0;
        let unmarkedFeatured = 0;

        const { data: unfeaturedAgentProps } = await admin
            .from('properties')
            .select('*')
            .eq('list_agent_mls_id', AGENT_MLS_ID)
            .eq('is_featured', false)
            .order('created_at', { ascending: false })
            .limit(100);

        const { data: allAgentProps } = await admin
            .from('properties')
            .select('*')
            .eq('list_agent_mls_id', AGENT_MLS_ID)
            .order('created_at', { ascending: false })
            .limit(200);

        const needsFeatured = (allAgentProps || []).filter(p => !p.is_featured);

        for (const prop of needsFeatured) {
            if (Date.now() - startTime > 20000) break;
            await admin
                .from('properties')
                .update({ is_featured: true })
                .eq('id', prop.id);
            markedFeatured++;
        }

        console.log(`Marked ${markedFeatured} properties as featured for agent ${AGENT_MLS_ID}`);

        const { data: wronglyFeatured } = await admin
            .from('properties')
            .select('*')
            .eq('is_featured', true)
            .order('created_at', { ascending: false })
            .limit(200);

        const toUnfeature = (wronglyFeatured || []).filter(p => {
            const agentId = (p.list_agent_mls_id || '').toLowerCase();
            return agentId !== AGENT_MLS_ID.toLowerCase();
        });

        for (const prop of toUnfeature) {
            if (Date.now() - startTime > 25000) break;
            await admin
                .from('properties')
                .update({ is_featured: false })
                .eq('id', prop.id);
            unmarkedFeatured++;
        }

        console.log(`Unmarked ${unmarkedFeatured} incorrectly featured properties`);

        const { data: cursorArr } = await admin
            .from('sync_cache')
            .select('*')
            .eq('sync_key', CURSOR_KEY);

        const cursorData = {
            sync_key: CURSOR_KEY,
            last_sync_date: new Date().toISOString(),
            sync_status: 'success',
            total_fetched: (allAgentProps || []).length,
            new_items: markedFeatured,
            updated_items: unmarkedFeatured,
            cached_data: {
                agent: AGENT_MLS_ID,
                total_agent_listings: (allAgentProps || []).length,
                newly_featured: markedFeatured,
                unfeatured_wrong: unmarkedFeatured
            }
        };

        if (cursorArr && cursorArr.length > 0) {
            await admin
                .from('sync_cache')
                .update(cursorData)
                .eq('id', cursorArr[0].id);
        } else {
            await admin.from('sync_cache').insert(cursorData);
        }

        return jsonResponse({
            success: true,
            agent: AGENT_MLS_ID,
            total_agent_listings_in_db: (allAgentProps || []).length,
            newly_marked_featured: markedFeatured,
            incorrectly_featured_removed: unmarkedFeatured,
            remaining_featured: ((allAgentProps || []).filter(p => p.is_featured).length + markedFeatured)
        });

    } catch (error) {
        console.error('syncFeaturedProperties error:', error);
        return jsonResponse({ error: (error as Error).message }, 500);
    }
});
