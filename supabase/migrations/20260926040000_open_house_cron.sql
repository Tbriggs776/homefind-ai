-- Open houses: syncOpenHouses refreshes properties.open_house_* from the Spark
-- RESO OpenHouse resource every 3 hours (dry run on 2026-09-26: ~6,000 upcoming
-- open houses across ~2,600 listings). Authenticates with the vault
-- 'service_role_key' secret, like the other cron jobs.
select cron.unschedule('sync-open-houses')
 where exists (select 1 from cron.job where jobname = 'sync-open-houses');

select cron.schedule(
  'sync-open-houses',
  '15 */3 * * *',
  $cron$
  select net.http_post(
    url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/syncOpenHouses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1))
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
