import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data } = await supabaseAdmin.from('properties').update({ is_featured: false })
      .eq('is_featured', true).neq('mls_status', 'Active').select('id');
    return jsonResponse({ cleaned: data?.length || 0 });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
