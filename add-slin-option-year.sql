-- Adds a structured Option Year field to slins (Base Year / OY1 / OY2 / ...)
-- so the Burndown UI can filter SLIN data by option year. Free text (not an
-- enum/CHECK) since option-year naming varies by contract. Run against the
-- Supabase demo/POC instance, verify, then apply to any other environment.

ALTER TABLE public.slins
  ADD COLUMN IF NOT EXISTS option_year text;

CREATE INDEX IF NOT EXISTS slins_option_year_idx ON public.slins(option_year);
