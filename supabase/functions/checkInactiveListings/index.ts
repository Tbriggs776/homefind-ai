import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin, corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const SPARK_API_BASE = 'https://replication.sparkapi.com/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const accessToken = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!accessToken) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    // Step 1: Get all listing keys from our local DB
    const { data: localListings } = await supabaseAdmin.from('properties').select('listing_key');
    const localKeys = new Set(localListings?.map((l: any) => l.listing_key) || []);

    // Step 2: Get all ACTIVE listing keys from Spark API
    // IDX COMPLIANCE: Only Active listings should remain in our DB (Rule 23.3.5)
    const sparkActiveKeys = new Set<string>();
    let skipToken = '';
    let page = 0;

    while (page < 200) {
      let url = `${SPARK_API_BASE}/listings?_limit=1000&_select=ListingKey&_filter=MlsStatus Eq 'Active'`;
      if (skipToken) url += `&_skiptoken=${skipToken}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) break;

      const data = await res.json();
      const results = data?.D?.Results || [];
      if (results.length === 0) break;

      results.forEach((r: any) => sparkActiveKeys.add(r.ListingKey || r.Id));

      skipToken = data?.D?.Pagination?.['@odata.nextLink']
        ? new URL(data.D.Pagination['@odata.nextLink']).searchParams.get('_skiptoken') || ''
        : '';
      if (!skipToken) break;
      page++;
    }

    // Step 3: Find local listings that are NOT in the active set from Spark
    // These are listings that either:
    //   - Changed status to Closed/Pending/Expired/Cancelled/Coming Soon
    //   - Were removed from the MLS entirely
    const staleKeys = [...localKeys].filter(k => !sparkActiveKeys.has(k));
    let purged = 0;

    for (let i = 0; i < staleKeys.length; i += 500) {
      const batch = staleKeys.slice(i, i + 500);
      const { error } = await supabaseAdmin.from('properties').delete().in('listing_key', batch);
      if (!error) purged += batch.length;
    }

    return jsonResponse({
      success: true,
      local: localKeys.size,
      spark_active: sparkActiveKeys.size,
      purged,
      message: `Removed ${purged} non-active listings from database`
    });
  } catch (err) {
    console.error('Check inactive error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
