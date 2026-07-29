-- Give the built-in Supabase roles the password from POSTGRES_PASSWORD.
--
-- supabase/postgres creates these roles but leaves them without a usable
-- password, so Auth (supabase_auth_admin), PostgREST (authenticator) and
-- Studio (supabase_admin) cannot connect until this runs.
--
-- Runs exactly once, when the data directory is first initialised. Changing
-- POSTGRES_PASSWORD later does NOT re-run it -- see docs/SELF-HOSTING.md.

-- Backtick form reads the environment variable psql was started with.
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- Parked in a GUC because psql does not interpolate :variables inside the
-- dollar-quoted block below.
select set_config('avernek.pgpass', :'pgpass', false);

do $$
declare
  role_name text;
begin
  -- Which of these exist varies by image version, so each is checked first
  -- rather than letting a missing role abort initialisation.
  foreach role_name in array array[
    'supabase_admin',
    'authenticator',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'supabase_functions_admin',
    'supabase_replication_admin',
    'supabase_read_only_user',
    'pgbouncer'
  ]
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'alter role %I with password %L',
        role_name,
        current_setting('avernek.pgpass')
      );
      raise notice 'password set for role %', role_name;
    end if;
  end loop;
end
$$;
