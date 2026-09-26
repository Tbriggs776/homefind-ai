-- ============================================================================
-- Price history
-- ----------------------------------------------------------------------------
-- The ARMLS RESO feed doesn't include OriginalListPrice / PreviousListPrice
-- (both are null on every listing), so "Price reduced" could never show. We
-- record price changes ourselves as the sync sees them:
--   - property_price_history: one row per change (public, read-only)
--   - properties.previous_list_price: the price before the latest change,
--     preserved across sync upserts (which send it as null)
-- History only exists from this migration forward.
-- ============================================================================

create table if not exists public.property_price_history (
  id          bigint generated always as identity primary key,
  property_id uuid not null references public.properties(id) on delete cascade,
  old_price   numeric not null,
  new_price   numeric not null,
  changed_at  timestamptz not null default now()
);

create index if not exists property_price_history_property_idx
  on public.property_price_history (property_id, changed_at desc);

alter table public.property_price_history enable row level security;
revoke all on public.property_price_history from anon, authenticated;
grant select on public.property_price_history to anon, authenticated;
drop policy if exists "Price history is public" on public.property_price_history;
create policy "Price history is public"
  on public.property_price_history for select
  to anon, authenticated
  using (true);

create or replace function public.track_property_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price
     and coalesce(old.price, 0) > 0
     and coalesce(new.price, 0) > 0 then
    new.previous_list_price := old.price;
    -- Prefer the MLS's own change timestamp when it's newer than what we had.
    new.price_change_date := greatest(coalesce(new.price_change_date, now()), coalesce(old.price_change_date, '-infinity'));
    begin
      insert into public.property_price_history (property_id, old_price, new_price, changed_at)
      values (new.id, old.price, new.price, now());
    exception when others then
      -- Never fail the listing sync over history bookkeeping.
      raise warning 'track_property_price_change: %', sqlerrm;
    end;
  else
    -- The sync upserts previous_list_price as null (the feed lacks it);
    -- keep the value we recorded.
    new.previous_list_price := coalesce(new.previous_list_price, old.previous_list_price);
  end if;
  return new;
end;
$$;

revoke all on function public.track_property_price_change() from public, anon, authenticated;

drop trigger if exists trg_track_property_price_change on public.properties;
create trigger trg_track_property_price_change
  before update on public.properties
  for each row execute function public.track_property_price_change();
