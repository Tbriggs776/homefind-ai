import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data, error } = await supabaseAdmin
      .from('properties')
      .delete()
      .ilike('property_type', '%rental%')
      .select('id');

    return jsonResponse({ removed: data?.length || 0 });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
