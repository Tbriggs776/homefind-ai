-- =============================================================================
-- Repoint Spark cron to the RESO-based sync, throttle the internal sync, and
-- retire the broken token-refresh job.
--
-- WHY: production cron was still calling the legacy syncSparkApiListings (/v1,
-- broken pagination) which had been erroring for ~19 days — no new listings
-- were being added. refreshSparkToken 404s every run. syncSparkInternalListings
-- ran every 2 min and was throwing Spark 503s (rate pressure).
-- =============================================================================

-- 1. spark-sync-incremental → syncListingsReso (RESO incremental, self-healing)
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spark-sync-incremental') THEN
    PERFORM cron.unschedule('spark-sync-incremental');
  END IF;
  PERFORM cron.schedule(
    'spark-sync-incremental',
    '*/10 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/syncListingsReso',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1))
        ),
        body := '{"mode": "incremental"}'::jsonb
      );
    $cmd$
  );
END $cron$;

-- 2. retire refresh-spark-token (calls a non-existent OAuth endpoint; 404s)
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-spark-token') THEN
    PERFORM cron.unschedule('refresh-spark-token');
  END IF;
END $cron$;

-- 3. throttle spark-sync-internal: every 2 min → every 15 min (it's resumable;
--    every-2-min was hammering Spark and 503'ing). Still /v1 for now — analytics
--    table only; a RESO migration of the internal sync is tracked separately.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spark-sync-internal') THEN
    PERFORM cron.unschedule('spark-sync-internal');
  END IF;
  PERFORM cron.schedule(
    'spark-sync-internal',
    '*/15 * * * *',
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
