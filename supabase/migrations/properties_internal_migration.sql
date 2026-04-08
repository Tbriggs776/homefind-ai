-- =============================================================================
-- properties_internal — HomeFind AI internal analytics table
-- =============================================================================
-- Admin-only table storing full ARMLS Spark listing data for market analytics.
-- Populated by syncSparkInternalListings edge function. Separate from the
-- public `properties` table to preserve IDX compliance isolation: the public
-- `properties` table is active-only for ARMLS Rule 23.3.5 IDX display, while
-- this table holds active, closed, pending, and other statuses for internal
-- CMA and market analysis by licensed agents.
--
-- Design principles:
--   - raw_data JSONB is the source of truth (all 816+ Spark fields)
--   - Typed columns cache the most-queried fields for fast aggregations
--   - RLS locks SELECT to admin users only
--   - No INSERT/UPDATE/DELETE policies — only service_role can write
--   - Compound indexes for common query patterns (city+status+date, etc.)
-- =============================================================================

-- Drop table if it exists (safe for re-running during dev; comment out for prod)
-- DROP TABLE IF EXISTS public.properties_internal CASCADE;

CREATE TABLE IF NOT EXISTS public.properties_internal (
  -- ── Identity ────────────────────────────────────────────────────────────
  id                                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  spark_listing_key                   TEXT          NOT NULL UNIQUE,  -- Spark ListingKey, the canonical dedup key
  mls_number                          TEXT,                           -- Spark ListingId, human-readable MLS #
  mls_status                          TEXT,                           -- 'Active', 'Closed', 'Pending', etc.
  standard_status                     TEXT,                           -- RESO StandardStatus
  property_type                       TEXT,                           -- Spark PropertyType code (A/B/C/D/E)
  property_sub_type                   TEXT,                           -- 'Single Family', 'Townhouse', 'Condo', etc.

  -- ── Price ───────────────────────────────────────────────────────────────
  list_price                          NUMERIC,
  close_price                         NUMERIC,
  original_list_price                 NUMERIC,                        -- Often redacted ('********') in your Spark tier
  previous_list_price                 NUMERIC,                        -- Often redacted
  list_price_per_sqft_calculated      NUMERIC GENERATED ALWAYS AS (
    CASE WHEN living_area_sqft > 0 AND list_price > 0
      THEN ROUND(list_price / living_area_sqft, 2)
      ELSE NULL END
  ) STORED,
  close_price_per_sqft_calculated     NUMERIC GENERATED ALWAYS AS (
    CASE WHEN living_area_sqft > 0 AND close_price > 0
      THEN ROUND(close_price / living_area_sqft, 2)
      ELSE NULL END
  ) STORED,
  concessions_amount                  NUMERIC,

  -- ── Timing / lifecycle ──────────────────────────────────────────────────
  listing_contract_date               DATE,
  on_market_date                      DATE,
  pending_date                        DATE,                           -- When it went under contract
  close_date                          DATE,
  cancel_date                         DATE,                           -- Often redacted
  withdraw_date                       DATE,
  status_change_timestamp             TIMESTAMPTZ,
  modification_timestamp              TIMESTAMPTZ,                    -- Spark ModificationTimestamp, used for incremental sync cursor
  back_on_market_timestamp            TIMESTAMPTZ,
  original_on_market_timestamp        TIMESTAMPTZ,
  photos_change_timestamp             TIMESTAMPTZ,

  -- Computed DOM metrics (generated columns, always in sync with the date fields)
  days_listing_to_contract            INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN pending_date IS NOT NULL AND listing_contract_date IS NOT NULL
        THEN (pending_date - listing_contract_date)
      ELSE NULL
    END
  ) STORED,
  days_contract_to_close              INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN close_date IS NOT NULL AND pending_date IS NOT NULL
        THEN (close_date - pending_date)
      ELSE NULL
    END
  ) STORED,
  days_listing_to_close               INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN close_date IS NOT NULL AND listing_contract_date IS NOT NULL
        THEN (close_date - listing_contract_date)
      ELSE NULL
    END
  ) STORED,

  -- ── Property specs ──────────────────────────────────────────────────────
  beds_total                          INTEGER,
  baths_full                          NUMERIC,
  baths_half                          NUMERIC,
  baths_total_decimal                 NUMERIC,
  baths_total_integer                 INTEGER,
  living_area_sqft                    NUMERIC,                        -- From LivingArea
  building_area_total_sqft            NUMERIC,                        -- From BuildingAreaTotal (may differ from LivingArea for multi-level)
  lot_size_sqft                       NUMERIC,
  lot_size_acres                      NUMERIC,
  year_built                          INTEGER,
  stories                             NUMERIC,
  garage_spaces                       NUMERIC,
  carport_spaces                      NUMERIC,

  -- ── Location ────────────────────────────────────────────────────────────
  unparsed_address                    TEXT,                           -- Full single-line address
  street_number                       TEXT,
  street_name                         TEXT,
  city                                TEXT,
  state_or_province                   TEXT,
  postal_code                         TEXT,
  county_or_parish                    TEXT,
  subdivision_name                    TEXT,
  latitude                            NUMERIC,
  longitude                           NUMERIC,
  elementary_school                   TEXT,
  middle_school                       TEXT,
  high_school                         TEXT,
  school_district                     TEXT,

  -- ── List side (selling agent) ───────────────────────────────────────────
  list_agent_mls_id                   TEXT,
  list_agent_name                     TEXT,
  list_agent_email                    TEXT,
  list_agent_direct_phone             TEXT,
  list_office_mls_id                  TEXT,
  list_office_name                    TEXT,
  co_list_agent_mls_id                TEXT,
  co_list_agent_name                  TEXT,

  -- ── Buyer side (populated on closed listings) ──────────────────────────
  buyer_agent_mls_id                  TEXT,
  buyer_agent_name                    TEXT,
  buyer_office_mls_id                 TEXT,
  buyer_office_name                   TEXT,
  co_buyer_agent_mls_id               TEXT,
  co_buyer_agent_name                 TEXT,
  buyer_financing                     TEXT,                           -- Often redacted

  -- ── Feature flags ───────────────────────────────────────────────────────
  pool_yn                             BOOLEAN,
  cooling_yn                          BOOLEAN,
  heating_yn                          BOOLEAN,
  fireplace_yn                        BOOLEAN,
  basement_yn                         BOOLEAN,
  attached_garage_yn                  BOOLEAN,
  new_construction_yn                 BOOLEAN,
  comp_sale_yn                        BOOLEAN,                        -- ARMLS valid-comparable-sale flag, used for CMA filtering
  horse_yn                            BOOLEAN,
  waterfront_yn                       BOOLEAN,

  -- ── Computed helper flags ──────────────────────────────────────────────
  -- Fast "is this a Crandell team listing" check. Updated by sync function
  -- based on list_agent_mls_id or co_list_agent_mls_id matching 'pc295'.
  is_crandell_listing                 BOOLEAN       NOT NULL DEFAULT false,

  -- ── Raw data — the full Spark response, nulls stripped ─────────────────
  -- This is the source of truth. Any field not in the typed columns above
  -- is still queryable via raw_data->>'FieldName' or raw_data->'SomeObject'.
  -- The sync strips nulls before insert to save ~40% storage per row.
  raw_data                            JSONB         NOT NULL,

  -- ── Metadata ────────────────────────────────────────────────────────────
  synced_at                           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  spark_sync_version                  INTEGER       NOT NULL DEFAULT 1,
  created_at_internal                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes — optimized for the query patterns the Market Pulse dashboard uses
-- =============================================================================

-- Core single-column indexes
CREATE INDEX IF NOT EXISTS idx_pi_mls_status
  ON public.properties_internal (mls_status);

CREATE INDEX IF NOT EXISTS idx_pi_city
  ON public.properties_internal (city);

CREATE INDEX IF NOT EXISTS idx_pi_postal_code
  ON public.properties_internal (postal_code);

CREATE INDEX IF NOT EXISTS idx_pi_subdivision_name
  ON public.properties_internal (subdivision_name);

-- Close date DESC for recent-sales queries (most common time-based filter)
CREATE INDEX IF NOT EXISTS idx_pi_close_date_desc
  ON public.properties_internal (close_date DESC NULLS LAST);

-- Listing contract date for new-listing velocity queries
CREATE INDEX IF NOT EXISTS idx_pi_listing_contract_date_desc
  ON public.properties_internal (listing_contract_date DESC NULLS LAST);

-- Agent lookups
CREATE INDEX IF NOT EXISTS idx_pi_list_agent_mls_id
  ON public.properties_internal (list_agent_mls_id);

CREATE INDEX IF NOT EXISTS idx_pi_buyer_agent_mls_id
  ON public.properties_internal (buyer_agent_mls_id);

-- Compound index for the most common Market Pulse query pattern:
-- "closed listings in this city in the last N months"
CREATE INDEX IF NOT EXISTS idx_pi_city_status_close
  ON public.properties_internal (city, mls_status, close_date DESC NULLS LAST);

-- Incremental sync cursor — we query modification_timestamp > last_sync_time
CREATE INDEX IF NOT EXISTS idx_pi_modification_timestamp_desc
  ON public.properties_internal (modification_timestamp DESC NULLS LAST);

-- Partial index for Crandell team queries — only indexes the small subset of
-- rows where is_crandell_listing = true, very fast and compact
CREATE INDEX IF NOT EXISTS idx_pi_is_crandell
  ON public.properties_internal (close_date DESC NULLS LAST)
  WHERE is_crandell_listing = true;

-- Price-band analytics
CREATE INDEX IF NOT EXISTS idx_pi_close_price
  ON public.properties_internal (close_price)
  WHERE close_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pi_list_price
  ON public.properties_internal (list_price)
  WHERE list_price IS NOT NULL;

-- GIN index on raw_data so ad-hoc JSONB queries (raw_data->>'SomeField') are fast
CREATE INDEX IF NOT EXISTS idx_pi_raw_data_gin
  ON public.properties_internal USING GIN (raw_data);

-- =============================================================================
-- Row Level Security — admin-only read access
-- =============================================================================

ALTER TABLE public.properties_internal ENABLE ROW LEVEL SECURITY;

-- SELECT policy: only admin users (role='admin' or is_user_admin=true) can read
CREATE POLICY "Admins can read properties_internal"
  ON public.properties_internal
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.role = 'admin' OR profiles.is_user_admin = true)
    )
  );

-- NO INSERT/UPDATE/DELETE policies are created.
-- This is intentional — only the service_role key (used by edge functions)
-- bypasses RLS and can write. Public users and authenticated non-admins
-- can neither read nor write this table.

-- =============================================================================
-- Sync cursor row in sync_cache
-- =============================================================================
-- The existing sync_cache table already exists and is used by the public sync.
-- We add a new row for the internal sync cursor state. Keys are namespaced to
-- avoid collision with the existing 'spark_api_listings' cursor.

-- (No DDL needed — just a convention that syncSparkInternalListings will
-- upsert into sync_cache with key 'spark_internal_sync_cursor')

-- =============================================================================
-- Helper view: recent Crandell team sales for fast dashboard queries
-- =============================================================================
-- A convenience view that pre-filters to the Crandell team's closed deals.
-- Not strictly needed but makes the dashboard queries simpler and clearer.

CREATE OR REPLACE VIEW public.v_crandell_recent_sales AS
SELECT
  id,
  spark_listing_key,
  mls_number,
  unparsed_address,
  city,
  postal_code,
  subdivision_name,
  list_price,
  close_price,
  close_price_per_sqft_calculated,
  close_date,
  listing_contract_date,
  pending_date,
  days_listing_to_contract,
  days_contract_to_close,
  days_listing_to_close,
  beds_total,
  baths_total_integer,
  living_area_sqft,
  list_agent_mls_id,
  list_agent_name,
  buyer_agent_mls_id,
  buyer_agent_name,
  buyer_office_name
FROM public.properties_internal
WHERE is_crandell_listing = true
  AND mls_status = 'Closed'
  AND close_date IS NOT NULL
ORDER BY close_date DESC;

-- Inherit RLS from the base table — the view only returns rows that
-- properties_internal's RLS policy allows.
ALTER VIEW public.v_crandell_recent_sales SET (security_invoker = true);

-- =============================================================================
-- DONE
-- =============================================================================
-- After running this migration:
--   1. Verify table exists: SELECT COUNT(*) FROM properties_internal;  (should return 0)
--   2. Verify RLS is enabled: SELECT relrowsecurity FROM pg_class WHERE relname = 'properties_internal';  (should return 't')
--   3. Verify policy exists: SELECT policyname FROM pg_policies WHERE tablename = 'properties_internal';
--   4. Verify indexes: SELECT indexname FROM pg_indexes WHERE tablename = 'properties_internal';
--
-- Next step: deploy syncSparkInternalListings edge function (Phase 2 part 2)
