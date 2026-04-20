import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

import HeroStatsStrip from '@/components/market-pulse/HeroStatsStrip';
import TopCitiesTable from '@/components/market-pulse/TopCitiesTable';
import CrandellTeamSpotlight from '@/components/market-pulse/CrandellTeamSpotlight';
import RecentSalesFeed from '@/components/market-pulse/RecentSalesFeed';
import PriceBandChart from '@/components/market-pulse/PriceBandChart';

/**
 * MarketPulse — Admin-only market intelligence dashboard for HomeFind AI
 *
 * Pulls data from the `properties_internal` table (residential-only, active +
 * pending + 24 months of closed) and presents a four-zone market snapshot:
 *
 *   Zone 1: HeroStatsStrip        — four headline KPIs across the top
 *   Zone 2: TopCitiesTable         — sortable city-level activity table
 *   Zone 3: CrandellTeamSpotlight  — team-specific metrics + recent deals
 *   Zone 3: RecentSalesFeed        — last 10 closings across the metro
 *   Zone 4: PriceBandChart         — active inventory distribution by price band
 *
 * Access control: admins only. Non-admins are redirected to `/`. The underlying
 * RLS policy on `properties_internal` enforces this at the database level too,
 * so the redirect is UX polish rather than the security boundary.
 *
 * Data architecture: six independent queries run in parallel on mount, each
 * with a 5-minute stale time. The sync cron fills the table every ~2 minutes,
 * so 5-minute client caching keeps things fresh without hammering the DB.
 *
 * The queries are intentionally server-side aggregated (GROUP BY, COUNT, AVG
 * pushed into PostgREST RPC or raw SQL via .rpc()) rather than hauling rows
 * into the browser. Each card gets exactly the shape it needs.
 */

// Tokens matching AnalyticsDashboard for visual cohesion
const BRAND = '#00AFE5';

export default function MarketPulse() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Access gate: redirect non-admins to home
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin' && user.is_user_admin !== true) {
      navigate('/');
    }
  }, [user, navigate]);

  const isAdmin = user?.role === 'admin' || user?.is_user_admin === true;

  // ── Query 1: Hero stats (single RPC call) ─────────────────────────────────
  // Uses the mp_hero_stats Postgres function defined in
  // supabase/migrations/mp_hero_stats.sql. The function computes all four
  // hero-card metrics in-database from a LAGGED 300→60 day window to work
  // around ARMLS reporting lag (trailing 30/60d windows are biased toward
  // slow-reporting deals and give implausible numbers).
  //
  // If the migration hasn't been applied, we fall back to a minimal query
  // that at least gives the active total so the page still renders.
  const heroQuery = useQuery({
    queryKey: ['mp-hero-stats'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('mp_hero_stats');
      if (!rpcErr && rpcData) {
        const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        return {
          active_total: Number(row.active_total) || 0,
          closed_lagged: Number(row.closed_lagged) || 0,
          median_close_price: row.median_close_price != null ? Number(row.median_close_price) : null,
          median_dom: row.median_dom != null ? Number(row.median_dom) : null,
          months_of_inventory: row.months_of_inventory != null ? Number(row.months_of_inventory) : null,
          window_start: row.window_start,
          window_end: row.window_end,
          rpc_available: true,
        };
      }

      // Fallback: active count only (no RPC). The page will render with the
      // Active Listings card populated and the other three showing "—".
      const { count: activeCount } = await supabase
        .from('properties_internal')
        .select('id', { count: 'exact', head: true })
        .eq('mls_status', 'Active');

      return {
        active_total: activeCount || 0,
        closed_lagged: null,
        median_close_price: null,
        median_dom: null,
        months_of_inventory: null,
        window_start: null,
        window_end: null,
        rpc_available: false,
      };
    },
  });

  // ── Query 2: Top cities (aggregated by city) ─────────────────────────────
  // Fetches raw rows grouped by city. We pull from a prepared RPC if available,
  // otherwise build it client-side from a limited field selection.
  const citiesQuery = useQuery({
    queryKey: ['mp-top-cities'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('mp_top_cities');
      if (!rpcErr && rpcData) return rpcData;

      // Fallback: pull minimal fields for active + pending + recent closed
      const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

      // PostgREST's 1000-row cap means we need to paginate through the full
      // active set to get accurate city counts. For a 25k-row active table
      // that's ~26 round trips — fine, runs in parallel.
      const fetchAll = async (status, extraFilter = null) => {
        const rows = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          let q = supabase
            .from('properties_internal')
            .select('city, close_price, close_price_per_sqft_calculated, days_listing_to_close, close_date')
            .eq('mls_status', status)
            .not('city', 'is', null)
            .range(from, from + pageSize - 1);
          if (extraFilter) q = extraFilter(q);
          const { data, error } = await q;
          if (error) throw error;
          if (!data || data.length === 0) break;
          rows.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
          if (from > 50000) break; // safety
        }
        return rows;
      };

      const [activeRows, pendingRows, closedRows] = await Promise.all([
        fetchAll('Active'),
        fetchAll('Pending'),
        fetchAll('Closed', (q) => q.gte('close_date', ninetyDaysAgo)),
      ]);

      // Aggregate by city
      const byCity = new Map();
      const getCity = (name) => {
        if (!byCity.has(name)) {
          byCity.set(name, {
            city: name,
            active: 0,
            pending: 0,
            closed_90d: 0,
            closed_prices: [],
            closed_psf: [],
            closed_doms: [],
          });
        }
        return byCity.get(name);
      };
      for (const r of activeRows) getCity(r.city).active++;
      for (const r of pendingRows) getCity(r.city).pending++;
      for (const r of closedRows) {
        const c = getCity(r.city);
        c.closed_90d++;
        if (r.close_price != null) c.closed_prices.push(r.close_price);
        if (r.close_price_per_sqft_calculated != null) c.closed_psf.push(Number(r.close_price_per_sqft_calculated));
        if (r.days_listing_to_close != null) c.closed_doms.push(r.days_listing_to_close);
      }
      const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
      const med = (arr) => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      return Array.from(byCity.values())
        .filter((c) => c.active >= 50) // minimum threshold to show up in top table
        .map((c) => ({
          city: c.city,
          active: c.active,
          pending: c.pending,
          closed_90d: c.closed_90d,
          avg_close_90d: avg(c.closed_prices),
          avg_psf_90d: avg(c.closed_psf),
          median_dom_90d: med(c.closed_doms),
        }))
        .sort((a, b) => b.active - a.active)
        .slice(0, 20);
    },
  });

  // ── Query 3: Crandell team metrics ───────────────────────────────────────
  const crandellQuery = useQuery({
    queryKey: ['mp-crandell'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties_internal')
        .select('mls_status, close_price, close_date, list_price, unparsed_address, city, days_listing_to_close')
        .eq('is_crandell_listing', true)
        .order('close_date', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Query 4: Recent metro sales feed ─────────────────────────────────────
  const recentSalesQuery = useQuery({
    queryKey: ['mp-recent-sales'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties_internal')
        .select('spark_listing_key, unparsed_address, city, close_price, close_date, close_price_per_sqft_calculated, beds_total, baths_total_integer, living_area_sqft, days_listing_to_close')
        .eq('mls_status', 'Closed')
        .not('close_date', 'is', null)
        .order('close_date', { ascending: false })
        .limit(15);
      if (error) throw error;
      return data || [];
    },
  });

  // ── Query 5: Price band distribution (active listings) ──────────────────
  const priceBandsQuery = useQuery({
    queryKey: ['mp-price-bands'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Define bands
      const bands = [
        { label: 'Under $300k', min: 0, max: 300_000 },
        { label: '$300k–$500k', min: 300_000, max: 500_000 },
        { label: '$500k–$750k', min: 500_000, max: 750_000 },
        { label: '$750k–$1M', min: 750_000, max: 1_000_000 },
        { label: '$1M–$1.5M', min: 1_000_000, max: 1_500_000 },
        { label: '$1.5M+', min: 1_500_000, max: Infinity },
      ];

      const results = await Promise.all(
        bands.map(async (band) => {
          let q = supabase
            .from('properties_internal')
            .select('id', { count: 'exact', head: true })
            .eq('mls_status', 'Active')
            .gte('list_price', band.min);
          if (Number.isFinite(band.max)) q = q.lt('list_price', band.max);
          const { count } = await q;
          return { label: band.label, count: count || 0 };
        })
      );
      return results;
    },
  });

  const isLoading =
    heroQuery.isLoading ||
    citiesQuery.isLoading ||
    crandellQuery.isLoading ||
    recentSalesQuery.isLoading ||
    priceBandsQuery.isLoading;

  const hasError =
    heroQuery.error ||
    citiesQuery.error ||
    crandellQuery.error ||
    recentSalesQuery.error ||
    priceBandsQuery.error;

  // Don't render anything for non-admins (useEffect above will redirect)
  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="crandell-container py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#00AFE5]/10">
                  <TrendingUp className="h-6 w-6 text-[#00AFE5]" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Market Pulse</h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Live residential market intelligence for the Crandell Real Estate Team · {format(new Date(), 'MMMM d, yyyy')}
                  </p>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              Data refreshed every 5 minutes
            </div>
          </div>
        </div>
      </div>

      {/* Main content grid */}
      <div className="crandell-container py-8 space-y-6">
        {hasError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="text-sm text-red-700 font-medium">Unable to load some market data.</p>
              <p className="text-xs text-red-600 mt-1">
                {hasError?.message || 'Check your connection and refresh the page.'}
              </p>
            </CardContent>
          </Card>
        )}

        {isLoading && !hasError && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 text-[#00AFE5] animate-spin mx-auto" />
              <p className="text-sm text-slate-500">Loading market data…</p>
            </div>
          </div>
        )}

        {!isLoading && !hasError && (
          <>
            {/* Zone 1: Hero stats */}
            <HeroStatsStrip data={heroQuery.data} />

            {/* Zone 2: Top cities */}
            <TopCitiesTable rows={citiesQuery.data || []} />

            {/* Zone 3: Crandell spotlight + Recent sales feed */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CrandellTeamSpotlight deals={crandellQuery.data || []} />
              <RecentSalesFeed sales={recentSalesQuery.data || []} />
            </div>

            {/* Zone 4: Price band distribution */}
            <PriceBandChart bands={priceBandsQuery.data || []} />
          </>
        )}
      </div>
    </div>
  );
}
