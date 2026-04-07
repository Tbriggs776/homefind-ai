import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/supabaseAdmin.ts';

// FRED API — public, no key required for these series
// MORTGAGE30US = 30-Year Fixed Rate Mortgage Average in the US (Freddie Mac PMMS)
// MORTGAGE15US = 15-Year Fixed Rate Mortgage Average in the US (Freddie Mac PMMS)

const FRED_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

async function fetchFredSeries(seriesId: string): Promise<number | null> {
  try {
    const today = new Date();
    const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const url = `${FRED_BASE}?id=${seriesId}&cosd=${fmt(past)}&coed=${fmt(today)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HomeFind-AI/1.0' },
    });

    if (!res.ok) {
      console.error(`FRED ${seriesId} fetch failed: ${res.status}`);
      return null;
    }

    const csv = await res.text();
    const lines = csv.trim().split('\n');

    // Walk backwards to find the most recent non-null value
    for (let i = lines.length - 1; i >= 1; i--) {
      const parts = lines[i].split(',');
      const value = parts[1]?.trim();
      if (value && value !== '.' && value !== '') {
        const num = parseFloat(value);
        if (!isNaN(num) && num > 0) return num;
      }
    }
    return null;
  } catch (err) {
    console.error(`FRED ${seriesId} error:`, err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const [thirtyYear, fifteenYear] = await Promise.all([
      fetchFredSeries('MORTGAGE30US'),
      fetchFredSeries('MORTGAGE15US'),
    ]);

    const baseRate = thirtyYear || 7.0;
    const fhaRate = baseRate - 0.25;
    const vaRate = baseRate - 0.30;
    const armRate = baseRate - 0.50;

    const rates = {
      thirty_year_fixed: thirtyYear,
      fifteen_year_fixed: fifteenYear,
      five_one_arm: parseFloat(armRate.toFixed(2)),
      fha_thirty_year: parseFloat(fhaRate.toFixed(2)),
      va_thirty_year: parseFloat(vaRate.toFixed(2)),
      source: 'Freddie Mac PMMS via FRED',
      updated_at: new Date().toISOString(),
    };

    return jsonResponse(rates);
  } catch (err: any) {
    console.error('getMortgageRates error:', err);
    return jsonResponse({
      thirty_year_fixed: 6.87,
      fifteen_year_fixed: 6.13,
      five_one_arm: 6.37,
      fha_thirty_year: 6.62,
      va_thirty_year: 6.57,
      source: 'fallback',
      error: err.message,
      updated_at: new Date().toISOString(),
    });
  }
});