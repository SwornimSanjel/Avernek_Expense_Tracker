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
- **Who owes whom** — exact named shares can include any member or guest. Older expenses without
  allocations still split equally between core members. Suggested transfers + reimbursements.
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

## The money rules (why the code looks the way it does)
- Every monetary column is Postgres `numeric` — **never float**.
- A historical expense **freezes** its rate. `amount_npr` never changes because today's rate moved.
- We use the NRB **sell** rate. If no rate exists for the exact date, we use the most recent one
  **on or before** it (never a future rate), and store the real rate date in `fx_rate_date`.
- The dashboard never adds raw USD to raw NPR, and never lets an estimate look like a confirmed
  figure — `pending` expenses are excluded from totals and surfaced for review.
