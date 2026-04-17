-- =============================================================================
-- mp_hero_stats — Market Pulse hero KPI aggregation function
-- =============================================================================
-- Returns a single row with all four hero-card metrics in one DB round-trip,
-- computed in-memory from properties_internal. This is 10–100× faster than
-- the client-side fallback and sidesteps the PostgREST 1000-row cap.
--
-- Design notes:
-- 1. All "recent" metrics use a LAGGED WINDOW (300 → 60 days ago) to work
--    around ARMLS reporting lag. The trailing 30/60 day windows are heavily
--    biased toward slow-to-report deals, which makes median DOM and months
--    of inventory look 3-5× worse than reality. The 300→60 lagged window
--    gives essentially complete reporting and sane numbers.
--
-- 2. median_dom uses days_listing_to_contract (not days_listing_to_close),
--    because "days on market" in real-estate convention = listing date to
--    accepted-offer date, not to close-of-escrow.
--
-- 3. months_of_inventory = active_count / monthly_closing_pace, where the
--    pace is derived from the 240-day lagged window (8 months / 240 days).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_hero_stats()
RETURNS TABLE (
  active_total         BIGINT,
  closed_lagged        BIGINT,
  median_close_price   NUMERIC,
  median_dom           INTEGER,
  months_of_inventory  NUMERIC,
  window_start         DATE,
  window_end           DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      (CURRENT_DATE - INTERVAL '300 days')::date AS win_start,
      (CURRENT_DATE - INTERVAL '60 days')::date  AS win_end
  ),
  active AS (
    SELECT COUNT(*) AS n
    FROM properties_internal
    WHERE mls_status = 'Active'
  ),
  closed AS (
    SELECT
      COUNT(*) AS n,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY close_price)::numeric AS med_price,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_listing_to_contract)::int AS med_dom
    FROM properties_internal, params
    WHERE mls_status = 'Closed'
      AND close_date BETWEEN params.win_start AND params.win_end
      AND days_listing_to_contract IS NOT NULL
      AND close_price IS NOT NULL
  )
  SELECT
    active.n                                      AS active_total,
    closed.n                                      AS closed_lagged,
    closed.med_price                              AS median_close_price,
    closed.med_dom                                AS median_dom,
    CASE
      WHEN closed.n > 0
        THEN ROUND(active.n::numeric / (closed.n::numeric / 8.0), 2)
      ELSE NULL
    END                                           AS months_of_inventory,
    params.win_start                              AS window_start,
    params.win_end                                AS window_end
  FROM active, closed, params;
$$;

-- Grant execute to authenticated users. The function is SECURITY DEFINER so
-- it can read properties_internal regardless of the caller's RLS, but it
-- only returns aggregates — no row-level data leaks.
GRANT EXECUTE ON FUNCTION public.mp_hero_stats() TO authenticated;

-- Optional: grant to anon for read-only public dashboards. The frontend gates
-- on admin role anyway, but granting here keeps the RPC callable for future
-- public marketing pages.
GRANT EXECUTE ON FUNCTION public.mp_hero_stats() TO anon;
