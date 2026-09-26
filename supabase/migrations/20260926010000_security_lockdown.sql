-- ============================================================================
-- Security lockdown, part 1: database
-- ----------------------------------------------------------------------------
-- 1. Stop privilege escalation through profiles.
--    users_update_own_profile only checks id = auth.uid(), and authenticated
--    holds UPDATE on every column, so any signed-in user could run
--      supabase.from('profiles').update({ role: 'admin' })
--    and become an admin. admin_update_all_profiles uses is_admin(), which
--    also counts user-admins, so a user-admin could promote anyone.
--    A column guard trigger now reserves role / is_user_admin /
--    fub_contact_id / invited_by for full admins (role = 'admin') and
--    server-side code. Everything else users legitimately edit (name,
--    onboarding flags, assigned_role by user-admins) is unaffected.
--
-- 2. Remove anonymous access to SECURITY DEFINER functions that were
--    callable via /rest/v1/rpc: list_cron_jobs (exposed cron commands),
--    handle_new_user and rls_auto_enable (trigger functions), and anon on
--    is_admin / mp_hero_stats.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles column guard
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user must reflect the caller.
-- Browser requests run as 'authenticated' (or 'anon'); the signup trigger
-- (handle_new_user, SECURITY DEFINER), the service role, and the dashboard
-- run as other roles and are trusted.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- AuthContext's client-side fallback insert: force safe defaults.
    new.role := 'user';
    new.is_user_admin := false;
    new.fub_contact_id := null;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_user_admin is distinct from old.is_user_admin
     or new.fub_contact_id is distinct from old.fub_contact_id
     or new.invited_by is distinct from old.invited_by then
    raise exception 'Only an admin can change role, admin access, invited_by, or CRM linkage'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_privileged_columns on public.profiles;
create trigger trg_profiles_guard_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- 2. RPC exposure
-- ---------------------------------------------------------------------------
-- Admin diagnostics only; nothing in the app calls it.
revoke execute on function public.list_cron_jobs() from public, anon, authenticated;
grant execute on function public.list_cron_jobs() to service_role;
alter function public.list_cron_jobs() set search_path = public;

-- Trigger functions — never meant to be called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
alter function public.handle_new_user() set search_path = public;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- is_admin() backs RLS policies that all apply to 'authenticated' only.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Market Pulse is an admin page for signed-in users.
revoke execute on function public.mp_hero_stats() from public, anon;
grant execute on function public.mp_hero_stats() to authenticated;
