import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { filter, limit = 10, offset = 0 } = await req.json();
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    let url = `https://replication.sparkapi.com/v1/listings?_limit=${limit}&_skip=${offset}`;
    if (filter) url += `&_filter=${encodeURIComponent(filter)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    const data = await res.json();
    return jsonResponse({ listings: data?.D?.Results || [], total: data?.D?.Pagination?.TotalRows || 0 });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
