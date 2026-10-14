-- =============================================================================
-- SUPERSEDED — intentionally does nothing.
--
-- This migration created RLS policies granting read access to the
-- `authenticated` role and write access to the owner, identified by
-- auth.jwt() ->> 'email' (hardcoded to xettrikenzon@gmail.com).
--
-- Neither exists outside Supabase: a plain Postgres database has no
-- `authenticated` role and no auth schema, so the original body failed with
-- `role "authenticated" does not exist` and broke every fresh install.
--
-- The same rules are now enforced in application code — see requireSession()
-- and requireAdmin() in src/lib/auth/server.ts, and assertAppOwner() in
-- src/lib/authz.ts, which reads users.is_admin instead of a hardcoded address.
-- db/migrations/20260729_local_auth.sql drops the policies from any database
-- where this migration had already run.
--
-- Kept as a file rather than deleted so the migration history stays contiguous.
-- =============================================================================

do $$
begin
  raise notice
    'skipping 20260728_team_access_owner_controls: superseded by 20260729_local_auth';
end
$$;
