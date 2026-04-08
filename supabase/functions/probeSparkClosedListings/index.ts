import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse, getUser } from '../_shared/supabaseAdmin.ts';

/**
 * probeSparkClosedListings — Diagnostic probe for Spark API
 *
 * Read-only, one-time diagnostic. Queries Spark for small samples of
 * Closed, Pending, Coming Soon, and Cancelled listings to discover what
 * fields are available for each status. Does NOT store any data.
 *
 * Used to design the properties_internal table schema for Phase 2 of the
 * Market Pulse build. Returns the complete field list from each status
 * sample plus anonymized sample records for inspection.
 *
 * Admin-only gated.
 */

const SPARK_REPL = 'https://replication.sparkapi.com/v1';

// Probe configuration — small samples only, no storage, no pagination
const PROBE_STATUSES = [
  { label: 'Closed', filter: "MlsStatus Eq 'Closed' And PropertyType Eq 'A'", limit: 10 },
  { label: 'Pending', filter: "MlsStatus Eq 'Pending' And PropertyType Eq 'A'", limit: 5 },
  { label: 'Coming Soon', filter: "MlsStatus Eq 'Coming Soon' And PropertyType Eq 'A'", limit: 5 },
  { label: 'Cancelled', filter: "MlsStatus Eq 'Cancelled' And PropertyType Eq 'A'", limit: 5 },
  // Also probe a broader "not active" to discover any statuses we don't know about
  { label: 'Sold', filter: "MlsStatus Eq 'Sold' And PropertyType Eq 'A'", limit: 5 },
];

/**
 * Anonymize a record before returning it — strip obvious personal data
 * so the probe output is safe to paste back to the dev even if copied.
 * Keeps addresses (MLS data is legally-public for licensed agents) but
 * masks buyer/agent private notes.
 */
function anonymize(record: any): any {
  const cleaned = { ...record };
  const stripKeys = [
    'ShowingInstructions',
    'PrivateRemarks',
    'ListAgentPrivateNotes',
    'BuyerAgentPrivateNotes',
    'BuyerContactName',
    'BuyerContactEmail',
    'BuyerContactPhone',
  ];
  stripKeys.forEach(k => {
    if (k in cleaned) cleaned[k] = '[REDACTED]';
  });
  return cleaned;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Admin-only gate — same pattern as inviteUserAdmin
    const user = await getUser(req);
    if (!user || (user.role !== 'admin' && user.is_user_admin !== true)) {
      return jsonResponse({ error: 'Admin required' }, 403);
    }

    const token = Deno.env.get('SPARK_OAUTH_ACCESS_TOKEN');
    if (!token) throw new Error('SPARK_OAUTH_ACCESS_TOKEN not set');

    const results: any = {
      probe_timestamp: new Date().toISOString(),
      spark_endpoint: SPARK_REPL,
      statuses: {},
      union_of_all_fields: new Set<string>(),
    };

    // Probe each status with no _select so Spark returns ALL fields
    for (const probe of PROBE_STATUSES) {
      try {
        const url = `${SPARK_REPL}/listings?_limit=${probe.limit}` +
          `&_filter=${encodeURIComponent(probe.filter)}`;

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'HomeFind-AI/2.0 (Diagnostic Probe)',
          },
        });

        if (!res.ok) {
          const errText = await res.text();
          results.statuses[probe.label] = {
            error: `HTTP ${res.status}`,
            detail: errText.slice(0, 500),
            filter_used: probe.filter,
          };
          continue;
        }

        const data = await res.json();
        const listings = data.D?.Results || [];

        // Collect all unique field names from every listing in this sample
        const fieldsInThisStatus = new Set<string>();
        listings.forEach((listing: any) => {
          // Spark nests most data under StandardFields; also capture top-level
          const standardFields = listing.StandardFields || listing;
          Object.keys(standardFields).forEach(k => {
            fieldsInThisStatus.add(k);
            (results.union_of_all_fields as Set<string>).add(k);
          });
          // Also capture top-level non-StandardFields keys like ListingKey, Id
          Object.keys(listing).forEach(k => {
            if (k !== 'StandardFields') {
              fieldsInThisStatus.add(`_root.${k}`);
              (results.union_of_all_fields as Set<string>).add(`_root.${k}`);
            }
          });
        });

        results.statuses[probe.label] = {
          filter_used: probe.filter,
          count_returned: listings.length,
          total_pagination_info: data.D?.Pagination || null,
          field_count: fieldsInThisStatus.size,
          fields: Array.from(fieldsInThisStatus).sort(),
          sample_records: listings.slice(0, 2).map((l: any) => {
            const sf = l.StandardFields || l;
            return {
              _root_keys: Object.keys(l),
              standard_fields: anonymize(sf),
            };
          }),
        };
      } catch (err) {
        results.statuses[probe.label] = { error: err.message };
      }
    }

    // Convert the Set to a sorted array for JSON serialization
    results.union_of_all_fields = Array.from(results.union_of_all_fields as Set<string>).sort();
    results.total_unique_fields_across_all_statuses = results.union_of_all_fields.length;

    // Summary of what we found, for quick scanning
    results.summary = Object.entries(results.statuses).map(([label, info]: any) => ({
      status: label,
      ok: !info.error,
      count: info.count_returned || 0,
      field_count: info.field_count || 0,
      note: info.error || 'OK',
    }));

    return jsonResponse(results);
  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
});
