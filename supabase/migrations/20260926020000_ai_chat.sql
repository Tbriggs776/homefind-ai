-- ============================================================================
-- AI chat support
-- ----------------------------------------------------------------------------
-- 1. ai_usage: per-day counters for rate limiting the AI chat (per IP for
--    signed-out visitors, per user when signed in) and anonymous lead
--    submissions. Service role only.
-- 2. fub_events: allow leads from signed-out visitors. The chat's tour
--    request collects name/email/phone; those rows have no user_id and carry
--    the contact in payload.person instead.
-- ============================================================================

create table if not exists public.ai_usage (
  key   text not null,
  day   date not null default (now() at time zone 'America/Phoenix')::date,
  count integer not null default 0,
  primary key (key, day)
);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Atomically count one hit against a daily limit. Returns true while the
-- caller is within the limit (the hit is counted either way).
create or replace function public.ai_usage_hit(p_key text, p_limit integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage (key, day, count)
  values (p_key, (now() at time zone 'America/Phoenix')::date, 1)
  on conflict (key, day) do update set count = public.ai_usage.count + 1
  returning count <= p_limit;
$$;

revoke all on function public.ai_usage_hit(text, integer) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(text, integer) to service_role;

-- Anonymous leads in the FUB outbox.
alter table public.fub_events alter column user_id drop not null;
alter table public.fub_events drop constraint if exists fub_events_identity_check;
alter table public.fub_events add constraint fub_events_identity_check
  check (user_id is not null or (payload ? 'person' and payload->'person' ? 'email'));
