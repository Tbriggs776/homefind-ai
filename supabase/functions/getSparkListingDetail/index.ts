import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { listingKey } = await req.json();
    if (!listingKey) throw new Error('listingKey required');
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    const res = await fetch(`https://replication.sparkapi.com/v1/listings/${listingKey}?_expand=Photos`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const data = await res.json();
    return jsonResponse({ listing: data?.D?.Results?.[0] || null });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
