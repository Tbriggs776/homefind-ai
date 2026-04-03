import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');
    return jsonResponse({ debug: 'debugAgentId', params: body, note: 'Debug function - use for Spark API troubleshooting' });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
