-- ============================================================================
-- Follow Up Boss event pipeline (outbox pattern)
-- ----------------------------------------------------------------------------
-- Buyer activity in the app becomes Follow Up Boss /v1/events so leads get
-- FUB's lead routing, action plans, and a real-time activity timeline.
--
--   app write (signup, save, view, search)
--        │  AFTER INSERT/UPDATE trigger — pure SQL, no network, never raises
--        ▼
--   public.fub_events  (status = 'pending')
--        │  pg_cron every minute → processFubEvents edge function
--        ▼
--   POST https://api.followupboss.com/v1/events  → status 'sent' / retry / 'failed'
--
-- Tour requests and questions (contactAgentForProperty) insert into the same
-- table and are sent immediately, falling back to the cron retry if FUB is
-- unreachable, so a lead is never silently dropped.
--
-- Admins (role = 'admin' or is_user_admin) are never sent to FUB.
-- ============================================================================

create table if not exists public.fub_events (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  event_type      text not null check (event_type in (
                    'Registration', 'Property Inquiry', 'Saved Property',
                    'Viewed Property', 'Property Search')),
  property_id     uuid,
  payload         jsonb not null default '{}'::jsonb,
  -- Unique when set: lets triggers enqueue idempotently with ON CONFLICT.
  dedupe_key      text unique,
  status          text not null default 'pending'
                    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  fub_status      integer,
  fub_person_id   text,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists fub_events_due_idx
  on public.fub_events (next_attempt_at)
  where status = 'pending';
create index if not exists fub_events_user_idx
  on public.fub_events (user_id, created_at desc);

-- Service role only. RLS on with no policies = invisible to anon/authenticated.
alter table public.fub_events enable row level security;
revoke all on public.fub_events from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Buyers only — the team's own accounts must not show up as leads.
create or replace function public.fub_should_track(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user_id
      and coalesce(role, 'user') <> 'admin'
      and coalesce(is_user_admin, false) = false
  );
$$;

-- Arizona has no DST, so a fixed zone gives stable "per day" dedupe keys.
create or replace function public.fub_local_day()
returns text
language sql
stable
set search_path = public
as $$ select to_char(now() at time zone 'America/Phoenix', 'YYYY-MM-DD') $$;

-- Claim a batch of due events for sending. SKIP LOCKED makes overlapping cron
-- runs safe; rows stuck in 'processing' for 10+ minutes (a crashed run) are
-- reclaimed.
create or replace function public.fub_claim_events(p_limit integer default 50)
returns setof public.fub_events
language sql
security definer
set search_path = public
as $$
  update public.fub_events e
     set status = 'processing', locked_at = now()
   where e.id in (
     select id from public.fub_events
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'processing' and locked_at < now() - interval '10 minutes')
      order by next_attempt_at
      limit p_limit
      for update skip locked
   )
  returning e.*;
$$;

revoke all on function public.fub_claim_events(integer) from public, anon, authenticated;
revoke all on function public.fub_should_track(uuid) from public, anon, authenticated;
grant execute on function public.fub_claim_events(integer) to service_role;

-- ----------------------------------------------------------------------------
-- Triggers. Each is wrapped so a pipeline problem can never fail the
-- underlying app write (a buyer saving a home matters more than the CRM ping).
-- ----------------------------------------------------------------------------

-- Signup → Registration (once per person)
create or replace function public.fub_enqueue_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if coalesce(new.role, 'user') <> 'admin' and coalesce(new.is_user_admin, false) = false then
      insert into public.fub_events (user_id, event_type, dedupe_key, next_attempt_at)
      values (new.id, 'Registration', 'reg:' || new.id,
              -- short delay so a name edited right after signup is picked up
              now() + interval '2 minutes')
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'fub_enqueue_registration failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_fub_registration on public.profiles;
create trigger trg_fub_registration
  after insert on public.profiles
  for each row execute function public.fub_enqueue_registration();

-- Save → Saved Property (once per home)
create or replace function public.fub_enqueue_saved_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if public.fub_should_track(new.user_id) then
      insert into public.fub_events (user_id, event_type, property_id, dedupe_key)
      values (new.user_id, 'Saved Property', new.property_id,
              'save:' || new.user_id || ':' || new.property_id)
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'fub_enqueue_saved_property failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_fub_saved_property on public.saved_properties;
create trigger trg_fub_saved_property
  after insert on public.saved_properties
  for each row execute function public.fub_enqueue_saved_property();

-- View → Viewed Property (once per home per day) and a Hot Lead event when
-- the same home is opened 3+ times in 7 days (once per home per week).
-- PropertyDetail inserts two 'view' rows per visit (mount with duration 0,
-- unmount with the real duration); only the mount row counts as a visit.
create or replace function public.fub_enqueue_viewed_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visits integer;
begin
  begin
    if new.interaction_type = 'view'
       and coalesce(new.duration_seconds, 0) = 0
       and public.fub_should_track(new.user_id) then

      insert into public.fub_events (user_id, event_type, property_id, dedupe_key)
      values (new.user_id, 'Viewed Property', new.property_id,
              'view:' || new.user_id || ':' || new.property_id || ':' || public.fub_local_day())
      on conflict (dedupe_key) do nothing;

      select count(*) into v_visits
        from public.property_views
       where user_id = new.user_id
         and property_id = new.property_id
         and interaction_type = 'view'
         and coalesce(duration_seconds, 0) = 0
         and created_at > now() - interval '7 days';

      if v_visits >= 3 then
        insert into public.fub_events (user_id, event_type, property_id, payload, dedupe_key)
        values (new.user_id, 'Viewed Property', new.property_id,
                jsonb_build_object('hot', true, 'visits', v_visits),
                'hot:' || new.user_id || ':' || new.property_id || ':'
                  || to_char(now() at time zone 'America/Phoenix', 'IYYY-IW'))
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'fub_enqueue_viewed_property failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_fub_viewed_property on public.property_views;
create trigger trg_fub_viewed_property
  after insert on public.property_views
  for each row execute function public.fub_enqueue_viewed_property();

-- Search → Property Search (once per day). Search.jsx upserts
-- search_preferences on every filter tweak, so instead of one event per tweak
-- we keep a single pending event per day and push its send time out 10
-- minutes on each change; the processor reads the latest preferences at send
-- time, so FUB gets where the buyer settled, not every intermediate click.
create or replace function public.fub_enqueue_property_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if public.fub_should_track(new.user_id) then
      insert into public.fub_events (user_id, event_type, dedupe_key, next_attempt_at)
      values (new.user_id, 'Property Search',
              'search:' || new.user_id || ':' || public.fub_local_day(),
              now() + interval '10 minutes')
      on conflict (dedupe_key) do update
        set next_attempt_at = excluded.next_attempt_at
        where public.fub_events.status = 'pending';
    end if;
  exception when others then
    raise warning 'fub_enqueue_property_search failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_fub_property_search on public.search_preferences;
create trigger trg_fub_property_search
  after insert or update on public.search_preferences
  for each row execute function public.fub_enqueue_property_search();

-- Trigger functions are only meant to run from their triggers.
revoke all on function public.fub_enqueue_registration() from public, anon, authenticated;
revoke all on function public.fub_enqueue_saved_property() from public, anon, authenticated;
revoke all on function public.fub_enqueue_viewed_property() from public, anon, authenticated;
revoke all on function public.fub_enqueue_property_search() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Cron: drain the outbox every minute. Authenticates with the vault
-- 'service_role_key' secret, like the other cron jobs.
-- ----------------------------------------------------------------------------
select cron.unschedule('process-fub-events')
 where exists (select 1 from cron.job where jobname = 'process-fub-events');

select cron.schedule(
  'process-fub-events',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://bfnudxyxgjhdqwlcqyar.supabase.co/functions/v1/processFubEvents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1))
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
