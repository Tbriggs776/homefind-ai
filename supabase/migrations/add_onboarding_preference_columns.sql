-- =============================================================================
-- add_onboarding_preference_columns.sql
-- =============================================================================
-- Extends user_preferences with columns captured during the buyer onboarding
-- quiz. These feed into the AI summary engine and personalized recommendations.
--
-- New columns:
--   priorities     TEXT[]   — what matters most (price, location, schools, etc.)
--   free_text      TEXT     — open-ended notes ("need a casita", "horse property")
--   single_story   BOOLEAN — wants single story only
--   min_lot_size   NUMERIC — minimum lot size in acres
-- =============================================================================

-- Ensure user_preferences table exists with the base columns.
-- If it already exists, these IF NOT EXISTS clauses are no-ops.
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  min_price     NUMERIC,
  max_price     NUMERIC,
  min_beds      INTEGER,
  min_baths     INTEGER,
  cities        TEXT[],
  property_types TEXT[],
  pool          BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Add new columns for the onboarding quiz
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS priorities    TEXT[],
  ADD COLUMN IF NOT EXISTS free_text     TEXT,
  ADD COLUMN IF NOT EXISTS single_story  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_lot_size  NUMERIC;

-- RLS: users can read/write their own preferences
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
CREATE POLICY "Users can view own preferences"
  ON public.user_preferences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
CREATE POLICY "Users can insert own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Admin read access
DROP POLICY IF EXISTS "Admins can view all preferences" ON public.user_preferences;
CREATE POLICY "Admins can view all preferences"
  ON public.user_preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.role = 'admin' OR profiles.is_user_admin = true)
    )
  );
