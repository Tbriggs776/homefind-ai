import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

/**
 * diagnoseSparkActive — read-only. Dumps one real RESO Property record (with
 * Media expanded) so we can map every field for the RESO-based sync rewrite.
 */

const RESO = 'https://replication.sparkapi.com/Reso/OData/Property';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!token) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    // One active residential record, all fields, with Media (photos) expanded.
    const url = `${RESO}?$top=1&$expand=Media&$filter=${encodeURIComponent("StandardStatus eq 'Active'")}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return jsonResponse({ httpErr: res.status, detail: (await res.text()).slice(0, 500) }, 200);
    const data = await res.json();
    const rec = (data.value || [])[0] || {};

    // Field inventory (names + sample values) and the Media shape.
    const fieldNames = Object.keys(rec).sort();
    const media = Array.isArray(rec.Media) ? rec.Media : [];
    const mediaSample = media.slice(0, 2);
    const mediaFields = media[0] ? Object.keys(media[0]).sort() : [];

    return jsonResponse({
      odata_count_available: typeof data['@odata.count'],
      field_count: fieldNames.length,
      field_names: fieldNames,
      media_count: media.length,
      media_fields: mediaFields,
      media_sample: mediaSample,
      full_record: rec,
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
