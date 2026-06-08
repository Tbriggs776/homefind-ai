-- Add last_synced_at column to properties table
-- Tracks when each listing was last seen in the Spark API active set.
-- Listings that drop out of the active set will have stale timestamps,
-- allowing queries to filter them out without relying on the unreliable
-- scan-and-diff purge in checkInactiveListings.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_properties_last_synced_at ON properties(last_synced_at);

-- Backfill existing rows so they aren't immediately filtered out
UPDATE properties SET last_synced_at = NOW() WHERE last_synced_at IS NULL;

-- Update the purge-stale-listings cron job to actually delete (was dry-run)
-- The safety checks in checkInactiveListings protect against bad data.
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
        body := '{"confirmDelete": true}'::jsonb
      );
    $cmd$
  );
END $cron$;
