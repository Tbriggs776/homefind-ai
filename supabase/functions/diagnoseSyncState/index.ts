import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

// Read-only production state diagnostic. NO writes.
// Reveals: which sync cursors are updating (=which job is actually running),
// cron schedule, and the property table breakdown.

async function countWhere(mods: (q: any) => any) {
  let q = supabaseAdmin.from('properties').select('*', { count: 'exact', head: true });
  q = mods(q);
  const { count, error } = await q;
  return error ? `err:${error.message}` : count;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const out: any = {};

    // 1. sync cursors (service role bypasses RLS)
    const { data: cursors } = await supabaseAdmin
      .from('sync_cache')
      .select('cache_key, updated_at, cache_value');
    out.sync_cursors = (cursors || []).map((c: any) => ({
      key: c.cache_key,
      updated_at: c.updated_at,
      value: c.cache_value,
    }));

    // 2. cron jobs (raw SQL via RPC if available; else note)
    try {
      const { data, error } = await supabaseAdmin.rpc('list_cron_jobs');
      out.cron_jobs = error ? `rpc err: ${error.message}` : data;
    } catch (e) {
      out.cron_jobs = `no rpc: ${String(e)}`;
    }

    // 3. property breakdown
    out.properties = {
      total: await countWhere((q) => q),
      active: await countWhere((q) => q.eq('status', 'active')),
      coming_soon: await countWhere((q) => q.eq('status', 'coming_soon')),
      pending: await countWhere((q) => q.eq('status', 'pending')),
      sold: await countWhere((q) => q.eq('status', 'sold')),
      non_active: await countWhere((q) => q.not('status', 'in', '(active,coming_soon)')),
      no_photos: await countWhere((q) => q.or('photo_count.is.null,photo_count.eq.0')),
      no_coords: await countWhere((q) => q.or('latitude.is.null,longitude.is.null')),
      tanner_pc295: await countWhere((q) => q.eq('list_agent_mls_id', 'pc295')),
      tanner_pc295_active: await countWhere((q) => q.eq('list_agent_mls_id', 'pc295').eq('status', 'active')),
    };

    return jsonResponse(out);
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
});
