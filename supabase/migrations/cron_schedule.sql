-- =============================================================================
-- cron_schedule — versioned definitions for all scheduled jobs
-- =============================================================================
-- Captures the live state of cron.job as of 2026-04-28. Prior to this file the
-- schedules existed only in the production cron.job table, set up ad-hoc in the
-- Supabase SQL editor, with no record in the repo. If the table got wiped or
-- the project moved, recovery would have been by-hand.
--
-- All jobs invoke edge functions via pg_net.http_post using the service-role
-- key from vault.decrypted_secrets. Idempotent: each block unschedules the job
-- if it already exists, then re-creates it.
--
-- WARNING: pg_cron's "succeeded" status only means net.http_post was queued.
-- It does NOT verify that the edge function returned 2xx. To check real health
-- look at net._http_response (joined to the request_id pg_cron emits) or each
-- function's own logs in the Supabase dashboard. As of this migration the
-- refresh-spark-token job has been silently 404'ing for an unknown duration.
-- =============================================================================

-- ─── 1. spark-sync-incremental — every 10 min ──────────────────────────────
-- Public properties table sync. Pulls Spark Replication API delta since the
-- cursor in sync_cache.spark_sync_cursor and upserts changed rows.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spark-sync-incremental') THEN
    PERFORM cron.unschedule('spark-sync-incremental');
  END IF;
  PERFORM cron.schedule(
    'spark-sync-incremental',
    '*/10 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/syncSparkApiListings',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1))
        ),
        body := '{"full_sync": false}'::jsonb
      );
    $cmd$
  );
END $cron$;

-- ─── 2. spark-sync-internal — every 2 min ──────────────────────────────────
-- Internal MLS mirror (properties_internal). Scoped to the brokerage's own
-- listings via list_agent_mls_id / co_list_agent_mls_id = 'pc295'. Powers the
-- Market Pulse admin page and CMA analytics.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spark-sync-internal') THEN
    PERFORM cron.unschedule('spark-sync-internal');
  END IF;
  PERFORM cron.schedule(
    'spark-sync-internal',
    '*/2 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/syncSparkInternalListings',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1))
        ),
        body := '{}'::jsonb
      );
    $cmd$
  );
END $cron$;

-- ─── 3. refresh-spark-token — every 30 min ─────────────────────────────────
-- WARNING: BROKEN — DO NOT TRUST.
-- The refreshSparkToken function calls a non-existent OAuth endpoint
-- (sparkplatform.com/v1/oauth2/grant returns 404 — Spark's actual API host
-- is sparkapi.com). Even if fixed, the function writes to sync_cache.spark_tokens
-- but syncSparkApiListings reads its token from the SPARK_OAUTH_ACCESS_TOKEN
-- env var, so refreshes are no-ops. Captured here for state parity only —
-- replace or unschedule once we decide whether token rotation is actually needed.
-- (The existing env-var token has been valid for weeks, suggesting Spark issues
-- long-lived tokens for this integration tier and rotation may be unnecessary.)
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-spark-token') THEN
    PERFORM cron.unschedule('refresh-spark-token');
  END IF;
  PERFORM cron.schedule(
    'refresh-spark-token',
    '*/30 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/refreshSparkToken',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1))
        ),
        body := '{}'::jsonb
      );
    $cmd$
  );
END $cron$;

-- ─── 4. purge-stale-listings — daily 10:00 UTC (3am AZ) ────────────────────
-- Calls Spark API for each Active row in our DB and reconciles status. Marks
-- listings as Closed/Pending/Withdrawn if their MLS state changed.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-stale-listings') THEN
    PERFORM cron.unschedule('purge-stale-listings');
  END IF;
  PERFORM cron.schedule(
    'purge-stale-listings',
    '0 10 * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/checkInactiveListings',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1))
        ),
        body := '{}'::jsonb
      );
    $cmd$
  );
END $cron$;

-- ─── 5. daily-fub-activity-summary — daily 15:00 UTC (8am AZ) ──────────────
-- Aggregates yesterday's user activity and posts a summary to Follow Up Boss
-- with AI-generated insights. Uses postDailyActivitySummary edge function.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-fub-activity-summary') THEN
    PERFORM cron.unschedule('daily-fub-activity-summary');
  END IF;
  PERFORM cron.schedule(
    'daily-fub-activity-summary',
    '0 15 * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/postDailyActivitySummary',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1))
        ),
        body := '{}'::jsonb
      );
    $cmd$
  );
END $cron$;
