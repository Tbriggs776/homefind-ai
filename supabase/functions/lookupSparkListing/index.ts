import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

const SPARK_REPL = 'https://replication.sparkapi.com/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!token) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');
    const body = await req.json().catch(() => ({}));
    const mlsNumber = body.mlsNumber || '6965362';
    const tests: Record<string, any> = {};

    const url1 = `${SPARK_REPL}/listings?_filter=${encodeURIComponent("ListingId Eq '" + mlsNumber + "'")}&_limit=5&_select=ListingId,ListingKey,MlsStatus,StandardStatus,PropertyType,PropertySubType,UnparsedAddress,City,StateOrProvince,PostalCode,ListPrice,ModificationTimestamp,ListAgentFullName,ListOfficeName`;
    const res1 = await fetch(url1, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const data1 = await res1.json();
    tests.lookup_by_ListingId_no_filter = { http_status: res1.status, results_count: data1?.D?.Results?.length || 0, results: data1?.D?.Results || [], raw_message: data1?.D?.Message };

    const url2 = `${SPARK_REPL}/listings?_filter=${encodeURIComponent("UnparsedAddress Like '*224TH*'")}&_limit=10&_select=ListingId,MlsStatus,PropertyType,UnparsedAddress,City`;
    const res2 = await fetch(url2, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const data2 = await res2.json();
    tests.lookup_by_address = { http_status: res2.status, results_count: data2?.D?.Results?.length || 0, results: data2?.D?.Results || [] };

    const url3 = `${SPARK_REPL}/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active'")}&_limit=1&_pagination=count&_select=ListingId`;
    const res3 = await fetch(url3, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const data3 = await res3.json();
    tests.total_active_no_PropertyType_filter = { http_status: res3.status, pagination: data3?.D?.Pagination };

    const url4 = `${SPARK_REPL}/listings?_filter=${encodeURIComponent("MlsStatus Eq 'Active' And PropertyType Eq 'A'")}&_limit=1&_pagination=count&_select=ListingId`;
    const res4 = await fetch(url4, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const data4 = await res4.json();
    tests.active_PropertyType_A_only = { http_status: res4.status, pagination: data4?.D?.Pagination };

    return jsonResponse({ mls_number_searched: mlsNumber, tests, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('lookupSparkListing error:', err);
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
});
