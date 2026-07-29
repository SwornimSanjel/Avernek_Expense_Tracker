# Avernek Expense Tracker

Internal spend tracker for Avernek Technologies. Next.js (App Router) + TypeScript +
Tailwind + Supabase (Postgres, Auth, RLS). Reports everything in **NPR**; handles USD
vendors with frozen, historically-accurate exchange rates from **Nepal Rastra Bank**.

## Features
- **Add expense** (mobile-first, <15s) — amount, currency, date, category, vendor, paid-by,
  client, note. NPR keypad-friendly.
- **USD handling** — three-tier rule for the NPR value of every USD expense:
  1. *Actual NPR charged* (from your statement) → `exact`
  2. *NRB sell rate for the expense date* → `official_estimate` (frozen forever)
  3. *Manual rate* → `manual_estimate`; if nothing is available → `pending`
- **Subscriptions** — recurring costs with default per-person shares; "Mark paid" can override
  the billing month, payer, amount, and split before logging the real expense.
- **Investment contributions** — exact named shares attribute each cost to contributors without
  creating personal debts or reimbursements. Older expenses without allocations still split
  equally between default-split participants.
- **Dashboard** — total to date, this month, projected next month, current USD rate,
  spend by category, 6-month trend.
- **Filters + CSV export.**

## One-time setup (~10 minutes)

### 1. Create a Supabase project
1. Go to <https://supabase.com> → **New project** (free tier is fine). Pick a region near Nepal
   (e.g. Singapore).
2. When it's ready: **Project Settings → API**. Copy:
   - `Project URL`
   - `anon public` key
   - `service_role` key (keep secret)

### 2. Environment variables
```bash
cp .env.local.example .env.local
```
Fill in `.env.local` with the three values above, plus a random `CRON_SECRET`
(`openssl rand -hex 32`).

### 3. Create the database
In the Supabase dashboard → **SQL Editor → New query**, paste the contents of
[`supabase/schema.sql`](supabase/schema.sql) and **Run**. Then do the same with
[`supabase/seed.sql`](supabase/seed.sql) (categories + vendors; the team-flagging line runs
after people sign in — re-run it later).

### 4. Turn on login
- **Authentication → Providers → Email**: enable. (Magic-link works with no extra setup.)
- *(Optional)* **Google**: enable the Google provider and add
  `https://YOUR-PROJECT.supabase.co/auth/v1/callback` as an authorized redirect URI in Google
  Cloud. For local dev, also add `http://localhost:3000/auth/callback` under
  **Authentication → URL Configuration → Redirect URLs**.
- Signed-in team members may view the tracker and add expenses. Only
  `xettrikenzon@gmail.com` may modify/delete existing records or protected settings. People may
  also exist only as participant rows in `public.users`, so they can be selected as payers and
  in expense splits without Auth accounts. Run
  `supabase/migrations/20260728_team_access_owner_controls.sql` after the base schema.

### 5. Receipt uploads (optional, for later)
Create a public Storage bucket named `receipts` (**Storage → New bucket**). The add-expense
form has a `receipt_url` field ready to wire to it.

## Run it
```bash
npm install
npm run dev
```
Open <http://localhost:3000>. Sign in with your email → magic link → you're in.

After all team members have signed in once, edit `supabase/seed.sql` with their emails and
re-run the final `update ... is_core_member` block (or just flip them on the **Settings** page).

## Deploy (Netlify)
1. Push this folder to a private GitHub repository. `.env.local` is ignored and must never be
   committed.
2. In Netlify, choose **Add new project → Import an existing project**, connect GitHub, and select
   the repository. Netlify detects Next.js; `netlify.toml` sets `npm run build` and `.next`.
3. In **Project configuration → Environment variables**, add the four values from `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. Keep the service-role key server-only.
4. Deploy, then copy the production URL, such as `https://avernek-expenses.netlify.app`.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to that production URL and
   add `https://YOUR-SITE.netlify.app/auth/callback` plus `http://localhost:3000/**` to Redirect URLs.
6. Redeploy after changing environment variables. The Netlify Scheduled Function `fx-refresh`
   runs every day at 04:00 UTC and calls the protected `/api/cron/fx` route.

For Netlify deploy previews, optionally allow `https://**--YOUR-SITE.netlify.app/**` in Supabase.

## Deploy (self-hosted: Docker + Jenkins)

An alternative to Netlify that runs the app on your own server. Netlify keeps working
unchanged — the standalone output is gated behind `DOCKER_BUILD=1`.

### Files
| File | Purpose |
| --- | --- |
| [`Dockerfile`](Dockerfile) | 3-stage build: `deps` → `builder` → `runner` (Next standalone server, non-root, no source or devDependencies in the final image) |
| [`docker-compose.yml`](docker-compose.yml) | Runs the app plus an `fx-cron` sidecar that replaces the Netlify Scheduled Function |
| [`docker/fx-cron.sh`](docker/fx-cron.sh) | busybox crond job that calls `/api/cron/fx` daily at 04:00 UTC |
| [`Jenkinsfile`](Jenkinsfile) | Extract `.env` → build → deploy → smoke test → auto-rollback |

### How the secrets flow
`NEXT_PUBLIC_*` values are inlined into the client bundle by `next build`, so they must
exist **at build time**; `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are server-only and
are injected **at runtime**. Both come from the same `.env`:

- **Build time** — the `.env` is mounted as a BuildKit secret at `/app/.env.production.local`
  for the single `RUN npm run build` command. It exists on a tmpfs for that command only and
  never lands in an image layer.
- **Runtime** — compose reads the `.env` sitting in the deploy directory (mode `0600`).

The `.env` is never copied into the build context ([`.dockerignore`](.dockerignore)), never
committed, and the workspace copy is deleted in the pipeline's `post { always }` block.

### Jenkins one-time setup
1. **Credential** — *Manage Jenkins → Credentials → Add → Kind: Secret file*. Upload your
   filled-in `.env` with ID **`avernek-expense-tracker-env`**.
2. **Deploy directory** — on the Jenkins host:
   ```bash
   sudo mkdir -p /opt/avernek-expense-tracker
   sudo chown jenkins:jenkins /opt/avernek-expense-tracker
   ```
3. **Docker access** — `sudo usermod -aG docker jenkins && sudo systemctl restart jenkins`.
   The agent also needs `git` and `curl`.
4. **Job** — new *Pipeline* job → *Pipeline script from SCM* → this repo, script path
   `Jenkinsfile`. Add a GitHub webhook (or poll SCM) to deploy on every push to `main`.

### What a build does
`Checkout → Extract .env → Build image → Deploy → Smoke test → Prune`. The pipeline tags each
image `avernek-expense-tracker:<BUILD_NUMBER>` plus `:latest`, records the previously running
image, and if `/api/health` does not answer within ~60s it redeploys the previous tag and fails
the build. The last 5 numbered images are kept on the host for manual rollbacks.

### Networking
Compose publishes to `127.0.0.1:3001` only — put nginx/Caddy in front for TLS, then set that
public URL as the Supabase **Site URL** and add `https://YOUR-DOMAIN/auth/callback` to the
redirect list. To expose the port directly instead, drop the `127.0.0.1:` prefix in
`docker-compose.yml`.

The published host port comes from `APP_PORT` (default `3001`, set in the `Jenkinsfile`). The
container itself always listens on 3000 — that is internal to the compose network, so leave the
right-hand side of the port mapping, the Dockerfile and `docker/fx-cron.sh` alone. Note that
local `npm run dev` still uses 3000.

### Run it locally without Jenkins
```bash
cp .env.local .env
docker compose up --build -d
docker compose ps
curl localhost:3001/api/health
```

> Values in `.env` containing a literal `$` need it doubled (`$$`) — compose treats `$` as
> variable interpolation when reading that file.

## The money rules (why the code looks the way it does)
- Every monetary column is Postgres `numeric` — **never float**.
- A historical expense **freezes** its rate. `amount_npr` never changes because today's rate moved.
- We use the NRB **sell** rate. If no rate exists for the exact date, we use the most recent one
  **on or before** it (never a future rate), and store the real rate date in `fx_rate_date`.
- The dashboard never adds raw USD to raw NPR, and never lets an estimate look like a confirmed
  figure — `pending` expenses are excluded from totals and surfaced for review.
