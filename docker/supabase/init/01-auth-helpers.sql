-- Safety net for auth.uid() and auth.jwt().
--
-- Every RLS policy in supabase/schema.sql is written in terms of these two
-- functions. supabase/postgres normally ships them, but if a future image drops
-- or renames them the policies fail closed in a very confusing way -- reads
-- return nothing and writes are denied, with no obvious cause.
--
-- So: create them only if they are genuinely absent. Never overwrite the
-- image's own versions, which may be newer than these.

create schema if not exists auth;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'jwt'
  ) then
    -- PostgREST publishes the verified token as a GUC. With
    -- PGRST_DB_USE_LEGACY_GUCS=false it is `request.jwt.claims`; the older
    -- `request.jwt.claim` is checked first for compatibility.
    execute $fn$
      create function auth.jwt() returns jsonb
      language sql stable
      as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $body$;
    $fn$;
    raise notice 'created auth.jwt()';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $body$;
    $fn$;
    raise notice 'created auth.uid()';
  end if;
end
$$;
