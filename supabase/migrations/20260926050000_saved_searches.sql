-- ============================================================================
-- Saved searches + listing alerts
-- ----------------------------------------------------------------------------
-- saved_searches           buyer-owned searches with an alert frequency
-- saved_search_hits        one row per (search, listing, reason) we've alerted on
-- property_status_history  status transitions recorded by trigger (the MLS
--                          feed has no history), for pending / back-on-market
--
-- processSavedSearches (hourly cron) finds new hits, emails the buyer a
-- digest (Resend) and notes it on their Follow Up Boss contact. Saving a
-- search sends FUB a "Saved Property Search" event through the outbox.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- saved_searches
-- ---------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 120),
  filters           jsonb not null default '{}'::jsonb,
  frequency         text not null default 'daily' check (frequency in ('instant', 'daily', 'weekly')),
  alerts_enabled    boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  last_run_at       timestamptz not null default now(),
  last_sent_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists saved_searches_user_idx on public.saved_searches (user_id, created_at desc);
create index if not exists saved_searches_due_idx on public.saved_searches (last_run_at) where alerts_enabled;

alter table public.saved_searches enable row level security;

drop policy if exists "Users manage their own saved searches" on public.saved_searches;
create policy "Users manage their own saved searches"
  on public.saved_searches for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Admins read saved searches" on public.saved_searches;
create policy "Admins read saved searches"
  on public.saved_searches for select
  to authenticated
  using (public.is_admin());

-- The unsubscribe token and run bookkeeping are server-managed. A column
-- REVOKE is a no-op while the table-level grant exists, so revoke UPDATE on
-- the table and grant back only the columns buyers may edit.
revoke all on public.saved_searches from anon;
revoke update on public.saved_searches from authenticated;
grant update (name, filters, frequency, alerts_enabled) on public.saved_searches to authenticated;

drop trigger if exists trg_saved_searches_updated_at on public.saved_searches;
create trigger trg_saved_searches_updated_at
  before update on public.saved_searches
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- saved_search_hits
-- ---------------------------------------------------------------------------
create table if not exists public.saved_search_hits (
  id              bigint generated always as identity primary key,
  saved_search_id uuid not null references public.saved_searches(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  reason          text not null check (reason in ('new', 'price_drop', 'pending', 'back_on_market')),
  -- Distinguishes repeat events of the same kind (e.g. a second price cut).
  event_key       text not null,
  detected_at     timestamptz not null default now(),
  notified_at     timestamptz,
  unique (saved_search_id, event_key)
);

create index if not exists saved_search_hits_search_idx on public.saved_search_hits (saved_search_id, detected_at desc);

alter table public.saved_search_hits enable row level security;
revoke all on public.saved_search_hits from anon, authenticated;
grant select on public.saved_search_hits to authenticated;

drop policy if exists "Users read hits for their searches" on public.saved_search_hits;
create policy "Users read hits for their searches"
  on public.saved_search_hits for select
  to authenticated
  using (exists (
    select 1 from public.saved_searches s
    where s.id = saved_search_id and s.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- property_status_history
-- ---------------------------------------------------------------------------
create table if not exists public.property_status_history (
  id          bigint generated always as identity primary key,
  property_id uuid not null references public.properties(id) on delete cascade,
  old_status  text not null,
  new_status  text not null,
  changed_at  timestamptz not null default now()
);

create index if not exists property_status_history_changed_idx on public.property_status_history (changed_at desc);

alter table public.property_status_history enable row level security;
revoke all on public.property_status_history from anon, authenticated;
grant select on public.property_status_history to anon, authenticated;
drop policy if exists "Status history is public" on public.property_status_history;
create policy "Status history is public"
  on public.property_status_history for select
  to anon, authenticated
  using (true);

create or replace function public.track_property_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and old.status is not null and new.status is not null then
    begin
      insert into public.property_status_history (property_id, old_status, new_status)
      values (new.id, old.status, new.status);
    exception when others then
      raise warning 'track_property_status_change: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.track_property_status_change() from public, anon, authenticated;

drop trigger if exists trg_track_property_status_change on public.properties;
create trigger trg_track_property_status_change
  after update of status on public.properties
  for each row execute function public.track_property_status_change();

-- ---------------------------------------------------------------------------
-- FUB: "Saved Property Search" when a buyer saves a search
-- ---------------------------------------------------------------------------
alter table public.fub_events drop constraint if exists fub_events_event_type_check;
alter table public.fub_events add constraint fub_events_event_type_check
  check (event_type in ('Registration', 'Property Inquiry', 'Saved Property',
                        'Viewed Property', 'Property Search', 'Saved Property Search'));

create or replace function public.fub_enqueue_saved_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if public.fub_should_track(new.user_id) then
      insert into public.fub_events (user_id, event_type, payload, dedupe_key)
      values (new.user_id, 'Saved Property Search',
              jsonb_build_object('saved_search_id', new.id, 'name', new.name, 'filters', new.filters),
              'savedsearch:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'fub_enqueue_saved_search failed: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.fub_enqueue_saved_search() from public, anon, authenticated;

drop trigger if exists trg_fub_saved_search on public.saved_searches;
create trigger trg_fub_saved_search
  after insert on public.saved_searches
  for each row execute function public.fub_enqueue_saved_search();

-- ---------------------------------------------------------------------------
-- Cron: evaluate saved searches hourly at :05
-- ---------------------------------------------------------------------------
select cron.unschedule('process-saved-searches')
 where exists (select 1 from cron.job where jobname = 'process-saved-searches');

select cron.schedule(
  'process-saved-searches',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/processSavedSearches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1))
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
