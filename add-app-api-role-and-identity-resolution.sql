-- Adds what the Functions API needs to safely authenticate real users
-- against RLS, found while building the first live endpoint (GetMyProfile):
--
-- 1. app.resolve_profile_id(): resolves an Entra object id (the 'oid'
--    claim off the validated JWT) to the internal profiles.id. This has
--    to be SECURITY DEFINER (bypasses RLS for its own execution) because
--    profiles_select's RLS policy requires id = app.current_user_id(),
--    and app.current_user_id() is just a plain read of the app.user_id
--    session variable (confirmed via pg_get_functiondef, no DB lookup of
--    its own) -- so nothing can look up "which profiles.id is this Entra
--    user" without first knowing profiles.id, unless this one lookup step
--    is allowed to bypass RLS. Every RLS check after this point still
--    applies normally once app.user_id is set from this function's result.
--
-- 2. A dedicated app_api Postgres role for the Functions API to connect
--    as, instead of the coaadmin server admin account. Using the admin
--    account as the app's everyday runtime identity is a real gap: RLS
--    is only a meaningful boundary if the connecting role is actually
--    subject to it, and a bug in the API would otherwise run with full
--    admin rights instead of being contained by RLS. app_api gets normal
--    table-level DML rights (SELECT/INSERT/UPDATE/DELETE) -- RLS still
--    narrows what it can actually see/touch per row/table, including the
--    append-only audit-log tables that have no UPDATE/DELETE policy at
--    all (time_card_audit_log etc. -- see ssp-log.md 2026-08-06 entry).
--
-- Run this against the coa database as coaadmin (same connection you used
-- to pull the schema dump). Afterwards: set a password for app_api below,
-- store it in Key Vault as a new secret, and update the Function App's
-- POSTGRES_CONNECTION_STRING app setting to a Key Vault reference pointing
-- at it, using app_api (not coaadmin) as the connecting user.

create or replace function app.resolve_profile_id(p_entra_object_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select id from public.profiles where entra_object_id = p_entra_object_id;
$$;

-- Locked down to just the app's own role below -- this function is
-- effectively a scoped, single-purpose bypass around RLS, so it shouldn't
-- be callable by anyone/anything else.
revoke execute on function app.resolve_profile_id(uuid) from public;

-- CHANGE THIS PASSWORD before running -- pick your own, then store the
-- same value in Key Vault as a new secret (e.g.
-- psql-coa-prod-eus-app-api-password) right after this completes.
create role app_api with login password 'REPLACE_WITH_A_REAL_PASSWORD_BEFORE_RUNNING';

grant usage on schema public, app to app_api;
grant select, insert, update, delete on all tables in schema public to app_api;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_api;
grant execute on all functions in schema app to app_api;
alter default privileges in schema app
  grant execute on functions to app_api;

-- The one exception: only app_api may call the identity-resolution
-- bypass function above (already revoked from PUBLIC, granting explicitly
-- here since the blanket schema grant above doesn't retroactively cover
-- functions created before it, and this line makes the intent explicit
-- either way).
grant execute on function app.resolve_profile_id(uuid) to app_api;
