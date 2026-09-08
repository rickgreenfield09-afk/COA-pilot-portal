-- Adds employee self-service RLS access to assets/asset_requests, found
-- missing while building the Profile screen's Assets tab endpoints
-- (2026-09-08). Both tables currently have only one policy each
-- (assets_admin_all / asset_requests_admin_all, both app.is_admin()-only)
-- -- meaning a regular employee querying their own assigned assets or
-- their own asset requests currently gets zero rows back under RLS, not
-- an error. The frontend's My Profile > Assets tab expects every
-- employee to see their own equipment and submit requests, not just
-- admins, so this closes that gap.
--
-- Matches this schema's dominant convention for self+manager+admin read
-- access -- one combined SELECT policy with all three conditions OR'd
-- together (see profiles_select, time_entries_select,
-- travel_estimates_select, gov_training_completions_select, etc.), rather
-- than separate policies per role -- rather than the narrower
-- employee_travel_programs_self pattern (self OR admin only), since My
-- Team (non-admin supervisors reviewing their reports' equipment) needs
-- this too, matching how the frontend's team-assets screens already call
-- the same query shape for both My Team and Admin (shared function,
-- role/scope param, per CLAUDE.md's screen architecture rule).
--
-- Editing an asset record stays admin-only (assets_admin_all already
-- covers that) -- these are equipment records, not something an employee
-- or their supervisor self-attests. Submitting a request is self-service;
-- approving/denying one stays admin-only via asset_requests_admin_all.

create policy assets_select_self_or_manager
  on public.assets
  for select
  using (
    assigned_to = app.current_user_id()
    or app.is_manager_of(assigned_to)
    or app.is_admin()
  );

create policy asset_requests_select_self_or_manager
  on public.asset_requests
  for select
  using (
    requested_by = app.current_user_id()
    or app.is_manager_of(requested_by)
    or app.is_admin()
  );

create policy asset_requests_insert_self
  on public.asset_requests
  for insert
  with check (requested_by = app.current_user_id());
