-- =============================================================================
-- property_views — row-level security policies
-- =============================================================================
-- The property_views table was deployed without working INSERT/SELECT policies,
-- so every client-side tracking write (PropertyDetail mount/unmount, Search
-- favorite) was silently rejected with code 42501, leaving the Admin Dashboard
-- analytics tab empty.
--
-- The client code at src/pages/PropertyDetail.jsx:151 inserts fire-and-forget
-- (no .catch), so the rejection was invisible. This migration restores the
-- policies needed for tracking to flow end-to-end:
--
--   1. authenticated users may insert rows stamped with their own user_id
--   2. authenticated users may read their own rows (powers RecentlyViewed
--      and the Profile stats query)
--   3. admins (profiles.role = 'admin' OR profiles.is_user_admin = true) may
--      read all rows, for AdminDashboard analytics aggregation
--
-- Re-runnable: existing policies with these names are dropped first.
-- =============================================================================

ALTER TABLE public.property_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "property_views_insert_own"  ON public.property_views;
DROP POLICY IF EXISTS "property_views_select_own"  ON public.property_views;
DROP POLICY IF EXISTS "property_views_select_admin" ON public.property_views;

CREATE POLICY "property_views_insert_own"
  ON public.property_views
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "property_views_select_own"
  ON public.property_views
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "property_views_select_admin"
  ON public.property_views
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.is_user_admin = true)
    )
  );
