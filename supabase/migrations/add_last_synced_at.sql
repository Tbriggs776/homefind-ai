-- Add last_synced_at column to properties table.
-- Stamped on every upsert by syncSparkApiListings. Infrastructure for future
-- staleness detection — NOT currently used as a query filter, because the sync
-- is incremental-by-ModificationTimestamp: a genuinely-active listing that
-- hasn't been modified recently would have a stale last_synced_at, so filtering
-- on it would wrongly hide real listings.

ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_properties_last_synced_at ON properties(last_synced_at);

-- Backfill existing rows
UPDATE properties SET last_synced_at = NOW() WHERE last_synced_at IS NULL;

-- NOTE: purge-stale-listings cron remains in dry-run (body '{}'). Re-enabling
-- destructive deletes (confirmDelete:true) is intentionally NOT done here — the
-- full-DB reconciliation is structurally blocked (Spark returns ~8.7k active vs
-- ~36.6k stored, which trips the >80% purge safety gate). See discussion.
--
-- If an earlier version of this migration was run that set the cron to
-- confirmDelete:true, this block resets it back to dry-run:
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
