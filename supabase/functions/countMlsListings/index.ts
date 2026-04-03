import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { count: total } = await supabaseAdmin.from('properties').select('*', { count: 'exact', head: true });
    const { count: active } = await supabaseAdmin.from('properties').select('*', { count: 'exact', head: true }).eq('mls_status', 'Active');
    return jsonResponse({ total, active });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
