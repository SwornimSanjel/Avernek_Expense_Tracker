# Self-hosted Supabase

Moves the database and auth off Supabase cloud and onto your own server, so the
data and the backups are yours.

## What runs, and what does not

The app makes 66 PostgREST calls, 21 auth checks, and **zero** Storage, Realtime
or RPC calls. So this stack is only the parts that are actually used:

| Service | Image | Why |
|---|---|---|
| `db` | `supabase/postgres` | Your data. Not stock postgres — it ships the roles, extensions and `auth` helpers that the RLS policies assume. |
| `auth` | `supabase/gotrue` | Magic links and Google OAuth. This is the piece plain Postgres cannot give you. |
| `rest` | `postgrest/postgrest` | The REST API every `.from("...")` call already speaks. |
| `meta` | `supabase/postgres-meta` | Schema introspection for Studio. |
| `studio` | `supabase/studio` | **The admin panel** — table editor, SQL editor, user management. |

Omitted: Storage, Realtime, imgproxy, Edge Functions, Analytics, and **Kong**.
Kong's only job is routing `/auth/v1/*` and `/rest/v1/*` under one origin, and
Caddy already does that.

```
                    ┌─ expenses.avernek.com ──→ app container      :3001
Caddy (443) ────────┼─ supabase.avernek.com ──→ /auth/v1/* → auth  :9999
                    │                           /rest/v1/* → rest  :3005
                    └─ studio.avernek.com ────→ studio (basic auth) :3006
                                                      │
                                                   postgres :5433 (loopback)
```

**Application code does not change.** Auth, RLS and all 66 queries work as-is.
The only change is which URL the app points at.

---

## 1. Install

```bash
sudo mkdir -p /opt/avernek-supabase
sudo cp -r docker/supabase/. /opt/avernek-supabase/
cd /opt/avernek-supabase
```

## 2. Generate secrets

Hosted Supabase gave you `ANON_KEY` and `SERVICE_ROLE_KEY`. Self-hosted you mint
them: both are HS256 JWTs signed with `JWT_SECRET`, differing only in the `role`
claim. PostgREST validates them with that secret and assumes the role — which is
exactly what makes the existing RLS policies apply.

```bash
python3 /path/to/repo/scripts/supabase-keys.py
```

```bash
cp .env.example .env
chmod 600 .env
$EDITOR .env      # paste the four values, set SMTP, set the URLs
```

> **SMTP is not optional.** Hosted Supabase lent you a shared mailer. Without
> `SMTP_*`, "Email me a sign-in link" silently sends nothing. Any provider works
> (Resend, Postmark, SES, a Gmail app password). Give the sending domain SPF and
> DKIM or the links land in spam.

## 3. Caddy

Add to `/etc/caddy/Caddyfile`, alongside the blocks you already have:

```caddyfile
supabase.avernek.com {
	# handle_path strips the matched prefix before proxying, which is what
	# Kong would otherwise do. GoTrue serves /verify, not /auth/v1/verify.
	handle_path /auth/v1/* {
		reverse_proxy 127.0.0.1:9999
	}

	handle_path /rest/v1/* {
		reverse_proxy 127.0.0.1:3005
	}

	# Nothing else is a valid Supabase route; do not leak what is behind.
	handle {
		respond "Not found" 404
	}
}

# The admin panel. Studio has NO login of its own — anyone who reaches it has
# full database access. Basic auth is doing all the work here.
studio.avernek.com {
	basic_auth {
		admin $2a$14$REPLACE_WITH_REAL_HASH
	}
	reverse_proxy 127.0.0.1:3006
}
```

Generate the password hash and reload:

```bash
caddy hash-password --plaintext 'your-strong-password'
sudo systemctl reload caddy
```

Point `supabase.avernek.com` and `studio.avernek.com` at the server in DNS
first, or Caddy cannot issue certificates.

## 4. Start

```bash
cd /opt/avernek-supabase
docker compose up -d
docker compose ps
```

Check auth came up (it runs its own schema migrations on first boot):

```bash
docker compose logs auth | tail -30
curl -s http://127.0.0.1:9999/health
```

## 5. Load the schema

```bash
cd /path/to/repo
for f in supabase/schema.sql supabase/migrations/*.sql; do
  echo "--- $f"
  docker exec -i avernek-supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
```

`schema.sql` is written to be re-runnable (`if not exists` / `create or replace`).

---

## 6. Migrate the data from Supabase cloud

**Order matters.** `public.users.id` is the same value as `auth.users.id` — the
`on_auth_user_created` trigger copies it — and every expense references
`public.users.id`. Restore `public` first, then `auth.users`: the trigger's
`on conflict (id) do nothing` then makes the auth insert a no-op instead of a
duplicate-key error. Do it the other way round and the public restore collides
with trigger-created rows.

Get the connection string from the cloud dashboard: **Settings → Database →
Connection string → URI**.

```bash
export CLOUD="postgresql://postgres:PASSWORD@db.pndtgbikoxkxpqgtxjql.supabase.co:5432/postgres"
```

### 6a. Public data

```bash
docker run --rm -i supabase/postgres:17.6.1.157-mmlb \
  pg_dump "$CLOUD" --data-only --schema public \
    --no-owner --no-privileges --disable-triggers \
  > /tmp/public-data.sql

docker exec -i avernek-supabase-db \
  psql -U postgres -d postgres < /tmp/public-data.sql
```

`--disable-triggers` stops FK checks firing mid-load while tables are only
partly populated.

### 6b. Auth users

Do **not** dump the whole `auth` schema. Cloud GoTrue may be a different version
than the one here, and its table layout will not match what this GoTrue just
migrated. Copy only the stable columns:

```bash
docker run --rm -i supabase/postgres:17.6.1.157-mmlb \
  psql "$CLOUD" -c "\copy (
    select id, email, encrypted_password, email_confirmed_at,
           created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
           coalesce(aud,'authenticated'), coalesce(role,'authenticated')
    from auth.users
  ) to stdout with csv" > /tmp/auth-users.csv

docker exec -i avernek-supabase-db psql -U postgres -d postgres -c "\copy auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_user_meta_data, raw_app_meta_data, aud, role
) from stdin with csv"  < /tmp/auth-users.csv
```

```bash
rm -f /tmp/public-data.sql /tmp/auth-users.csv   # both contain personal data
```

### 6c. Verify

```bash
docker exec avernek-supabase-db psql -U postgres -d postgres -c "
  select 'auth.users' t, count(*) from auth.users
  union all select 'public.users', count(*) from public.users
  union all select 'expenses',     count(*) from public.expenses
  union all select 'orphaned',     count(*) from public.expenses e
             where not exists (select 1 from public.users u where u.id = e.paid_by);"
```

`orphaned` must be `0`. Anything else means the ID mapping broke — stop and fix
it before pointing the app at this database.

> If migrating `auth.users` proves painful, there is an escape hatch: sign-in is
> passwordless, so users can simply sign in again. But you must then update
> `public.users.id` to the new auth IDs, or their existing expenses orphan.
> Migrating the IDs is the easier path.

---

## 7. Point the app at it

Update the Jenkins credential (**Manage Jenkins → Credentials →
`avernek-expense-tracker-env`**):

```ini
NEXT_PUBLIC_SUPABASE_URL=https://supabase.avernek.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
CRON_SECRET=<unchanged>
```

Then run a build. `NEXT_PUBLIC_*` values are inlined into the client bundle at
build time, so **a rebuild is mandatory** — restarting the container is not
enough.

## 8. Google OAuth

In Google Cloud Console → Credentials → your OAuth client, add to **Authorised
redirect URIs**:

```
https://supabase.avernek.com/auth/v1/callback
```

Then set `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET` in `.env`
and `docker compose up -d auth`.

## 9. The redirect allow list

The setting that was sending sign-ins to Netlify now lives in `.env` as
`ADDITIONAL_REDIRECT_URLS`, with `SITE_URL` as the fallback. Same semantics as
the dashboard: a `redirectTo` not on the list is silently replaced by
`SITE_URL`. Both now live in version-controllable config instead of a web UI.

---

## Backups

```bash
./scripts/db-backup.sh          # dump + prune (KEEP=14)
./scripts/db-restore-drill.sh   # prove the newest dump restores — non-destructive
./scripts/db-restore.sh         # restore for real (confirms, and dumps first)
```

`db-backup.sh` dumps the whole database — `public` **and** `auth`. Dumping only
`public` restores a database nobody can log into.

**Run the drill.** It restores the dump into a throwaway container, checks the
tables have rows, checks `auth.users` is populated, checks the RLS policies came
back, compares against live, and destroys the container. A backup that has never
been restored is a guess.

```bash
# suggested cron
0 3 * * *  /path/to/repo/scripts/db-backup.sh
0 4 * * 0  /path/to/repo/scripts/db-restore-drill.sh
```

Retention is local-only. A dump on the same disk as the database does not
survive losing the server — copy them off the box.

---

## Troubleshooting

**Login redirects somewhere unexpected** — the origin is not in
`ADDITIONAL_REDIRECT_URLS`, so GoTrue substituted `SITE_URL`. Same failure mode
as the hosted dashboard setting.

**Magic-link emails never arrive** — `SMTP_*` is unset or wrong.
`docker compose logs auth | grep -i mail`.

**Every query returns empty and writes are denied** — `auth.uid()` is returning
NULL, so the RLS policies deny everything. Check `PGRST_JWT_SECRET` matches
`JWT_SECRET`, and that `init/01-auth-helpers.sql` ran.

**`password authentication failed`** — `init/00-roles.sql` runs *only* on an
empty data directory. If you changed `POSTGRES_PASSWORD` after the first start,
set it by hand:

```bash
docker exec -it avernek-supabase-db psql -U postgres -c \
  "alter role supabase_auth_admin with password 'NEW'; \
   alter role authenticator      with password 'NEW'; \
   alter role supabase_admin     with password 'NEW';"
```

**Studio loads but shows no tables** — `meta` cannot reach the database; check
`docker compose logs meta`.

**CORS errors in the browser** — GoTrue and PostgREST set their own CORS
headers. If a header is missing, add it in the Caddy block, but never add one
the upstream already sends: duplicate `Access-Control-Allow-Origin` is rejected
by every browser.
