import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

// =============================================================================
// getMortgageRates — weekly Freddie Mac PMMS rates via FRED JSON API
// =============================================================================
// Returns the latest 30-year and 15-year fixed rates from FRED series
// MORTGAGE30US and MORTGAGE15US. Freddie Mac publishes new numbers every
// Thursday around 10am ET.
//
// The earlier implementation scraped FRED's public `fredgraph.csv` download
// endpoint without an API key. That endpoint was flaky from Deno Deploy
// (intermittent blocks / slow responses), which caused both series to come
// back null and the ticker to fall through to a stale hardcoded fallback.
//
// Key is provided via Supabase secret FRED_API_KEY (do NOT commit).
//
// Other rate types (5/1 ARM, FHA, VA) are intentionally NOT returned —
// Freddie Mac discontinued MORTGAGE5US in Nov 2022, and there is no free
// authoritative source for FHA/VA. Previous synthetic deltas (30yr − 0.50
// etc.) were inaccurate in today's yield-curve environment.
// =============================================================================

const FRED_API = 'https://api.stlouisfed.org/fred/series/observations';

async function fetchFredLatest(seriesId: string, apiKey: string): Promise<{ rate: number; date: string } | null> {
  try {
    const url = `${FRED_API}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`FRED ${seriesId} HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const obs = json.observations?.[0];
    if (!obs || obs.value === '.' || !obs.value) return null;
    const rate = parseFloat(obs.value);
    if (isNaN(rate) || rate <= 0 || rate >= 30) return null;
    return { rate, date: obs.date };
  } catch (err) {
    console.error(`FRED ${seriesId} error:`, err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('FRED_API_KEY');
  if (!apiKey) {
    console.error('FRED_API_KEY is not set on the edge function');
    return jsonResponse({ error: 'FRED_API_KEY not configured', source: 'config_error' }, 500);
  }

  try {
    const [thirty, fifteen] = await Promise.all([
      fetchFredLatest('MORTGAGE30US', apiKey),
      fetchFredLatest('MORTGAGE15US', apiKey),
    ]);
    return jsonResponse({
      thirty_year_fixed: thirty?.rate ?? null,
      fifteen_year_fixed: fifteen?.rate ?? null,
      as_of: thirty?.date ?? fifteen?.date ?? null,
      source: 'Freddie Mac PMMS via FRED',
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('getMortgageRates error:', err);
    return jsonResponse({ error: err.message, source: 'error' }, 500);
  }
});
