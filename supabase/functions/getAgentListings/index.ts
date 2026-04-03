import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { agentId, limit = 50 } = await req.json();
    if (!agentId) throw new Error('agentId required');

    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('listing_agent_id', agentId)
      .eq('mls_status', 'Active')
      .order('listing_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return jsonResponse({ listings: data || [] });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
