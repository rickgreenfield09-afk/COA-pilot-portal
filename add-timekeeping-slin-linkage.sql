-- Phase 1 of linking Timekeeping to Burndown: schema only, no UI changes yet.
-- Goal: employees will (Phase 2) pick a SLIN when logging direct labor hours,
-- so the Burndown funding calculation (Phase 4) can be driven by real
-- submitted timesheets instead of a manually re-keyed spreadsheet.
--
-- Run against the Supabase demo/POC instance, verify, then apply to other
-- environments. Requires burndown-schema.sql to already be applied (this
-- references public.slins).

-- ---------------------------------------------------------------------------
-- 1) New time code: direct/billable labor. Today time_codes only has
-- indirect codes (Vacation, Holiday, Bid & Proposal, Business Development)
-- -- there's currently no way to log direct labor hours at all.
-- time_codes.category has a pre-existing CHECK constraint
-- (time_codes_category_check) allowing only 'gov_contract',
-- 'commercial_customer', or 'indirect' -- discovered when the first attempt
-- at this insert (using 'direct') failed against it. Used 'gov_contract'
-- here, matching this pilot's Navy/DoD subcontract work; Phase 2's UI keys
-- off category being 'gov_contract' or 'commercial_customer' (billable) vs.
-- 'indirect' to decide whether to show the SLIN picker for a given row.
-- ---------------------------------------------------------------------------

insert into public.time_codes (id, code, label, category, sort_order, active)
values (gen_random_uuid(), 'REGULAR', 'Regular / Direct Labor', 'gov_contract', 0, true);

-- ---------------------------------------------------------------------------
-- 2) time_entries.slin_id -- nullable (indirect entries like PTO never have
-- one; only rows logged against a billable time code will). No CHECK
-- constraint tying category to slin_id presence -- that validation lives in
-- the app layer in Phase 2, not the DB, since this is still pilot data and a
-- trigger adds more risk than it's worth at this stage.
-- ---------------------------------------------------------------------------

alter table public.time_entries add column if not exists slin_id uuid references public.slins(slin_id);

create index if not exists time_entries_slin_id_idx on public.time_entries(slin_id);

-- Verify afterward:
-- select id, code, label, category, sort_order from public.time_codes order by sort_order;
-- select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'time_entries' and column_name = 'slin_id';
