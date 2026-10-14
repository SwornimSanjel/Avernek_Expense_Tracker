-- =============================================================================
-- Replace Supabase Auth with local email + password authentication.
--
-- Before: sign-in went out to Supabase (GoTrue), came back through a redirect,
-- and authorization was enforced by RLS policies calling auth.uid().
--
-- After: the app authenticates against public.users directly and enforces
-- authorization in application code (requireSession / requireAdmin). Nothing
-- leaves the server, so there is no redirect to get wrong.
--
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. users becomes the identity table
-- -----------------------------------------------------------------------------
alter table public.users
  add column if not exists password_hash text;

alter table public.users
  add column if not exists is_admin boolean not null default false;

alter table public.users
  add column if not exists last_login_at timestamptz;

-- Sign-in looks users up by email. Case-insensitive so "A@b.com" and "a@b.com"
-- cannot become two accounts.
create unique index if not exists users_email_lower_key
  on public.users (lower(email));

comment on column public.users.password_hash is
  'scrypt$<salt>$<hash>. NULL means the account cannot sign in yet.';

-- -----------------------------------------------------------------------------
-- 2. Remove the Supabase auth trigger
--
-- handle_new_user() mirrored auth.users into public.users. There is no
-- auth.users any more; the app writes public.users itself.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    execute 'drop trigger if exists on_auth_user_created on auth.users';
  end if;
end
$$;

drop function if exists public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. Drop the RLS policies
--
-- Every policy was written in terms of auth.uid() / auth.jwt(), which only
-- exist when PostgREST is validating a Supabase JWT. Connecting directly as the
-- application role, those calls fail and the policies would deny everything.
--
-- Authorization now lives in the application: requireSession() gates reads,
-- requireAdmin() gates the owner-only mutations. This is a real trade -- the
-- database no longer independently enforces access -- so every route handler
-- and server action must check. See src/lib/auth/server.ts.
-- -----------------------------------------------------------------------------
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
    raise notice 'dropped policy % on %', policy_record.policyname, policy_record.tablename;
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'categories', 'vendors', 'fx_rates', 'recurring',
    'expenses', 'expense_shares', 'recurring_shares', 'settlements'
  ]
  loop
    if exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter table public.%I disable row level security', table_name);
    end if;
  end loop;
end
$$;
