-- Add theme_preference column to profiles for the Dark/Light appearance toggle
-- (Directory > My Profile > Overview). Run against your dev/demo Postgres/Supabase
-- instance, verify, then apply to any other environment.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'dark'
  CHECK (theme_preference IN ('dark', 'light'));
