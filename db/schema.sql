-- =============================================================================
-- Avernek Expense Tracker — database schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query -> Run).
-- Safe to re-run: uses "if not exists" / "create or replace" throughout.
--
-- MONEY RULE: every monetary column is numeric/decimal. NEVER float/double.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- users — people who can pay or share expenses. A participant does not need login.
-- Sign-in accounts live here too: password_hash and is_admin are added by
-- db/migrations/20260729_local_auth.sql.
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null unique,
  is_core_member boolean not null default false,
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  color          text not null default '#1e3a5f',      -- navy default
  monthly_budget numeric(14,2),                          -- nullable
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- vendors
-- -----------------------------------------------------------------------------
create table if not exists public.vendors (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  category_id      uuid references public.categories (id) on delete set null,
  default_currency text not null default 'NPR' check (default_currency in ('NPR','USD')),
  created_at       timestamptz not null default now(),
  unique (name)
);

-- -----------------------------------------------------------------------------
-- fx_rates — daily cache of Nepal Rastra Bank official rates.
-- Historical rows are IMMUTABLE (see FX rule). One row per (date, currency pair).
-- -----------------------------------------------------------------------------
create table if not exists public.fx_rates (
  id             uuid primary key default gen_random_uuid(),
  rate_date      date not null,
  base_currency  text not null default 'USD',
  quote_currency text not null default 'NPR',
  buy_rate       numeric(14,6),
  sell_rate      numeric(14,6),
  source         text not null default 'nrb',           -- 'nrb' | 'manual'
  fetched_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (rate_date, base_currency, quote_currency)
);
create index if not exists fx_rates_lookup
  on public.fx_rates (base_currency, quote_currency, rate_date desc);

-- -----------------------------------------------------------------------------
-- recurring — subscriptions. These GENERATE projected future expenses;
-- projections are not stored until the renewal date passes.
-- -----------------------------------------------------------------------------
create table if not exists public.recurring (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  amount            numeric(14,2) not null check (amount >= 0),
  currency          text not null default 'NPR' check (currency in ('NPR','USD')),
  cycle             text not null check (cycle in ('monthly','annual')),
  next_renewal_date date not null,
  category_id       uuid references public.categories (id) on delete set null,
  vendor_id         uuid references public.vendors (id) on delete set null,
  paid_by_user_id   uuid references public.users (id) on delete set null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- expenses
--   amount           : original amount in `currency`
--   amount_npr       : resolved NPR value (see 3-tier FX rule in app code)
--   fx_rate_to_npr   : the frozen rate used to derive amount_npr (1 for NPR)
--   fx_rate_date     : the date the frozen rate actually belongs to
--   actual_npr_charged : exact figure from bank/card statement, if known
--   fx_source        : 'actual' | 'nrb' | 'manual' | 'estimated' | 'pending'
--   conversion_status: 'exact' | 'official_estimate' | 'manual_estimate' | 'pending'
-- -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  amount             numeric(14,2) not null check (amount >= 0),
  currency           text not null default 'NPR' check (currency in ('NPR','USD')),
  fx_rate_to_npr     numeric(14,6) not null default 1,
  amount_npr         numeric(14,2),
  actual_npr_charged numeric(14,2),
  fx_source          text not null default 'actual'
                       check (fx_source in ('actual','nrb','manual','estimated','pending')),
  fx_rate_date       date,
  conversion_status  text not null default 'exact'
                       check (conversion_status in ('exact','official_estimate','manual_estimate','pending')),
  expense_date       date not null default current_date,
  billing_month      date,
  category_id        uuid references public.categories (id) on delete set null,
  vendor_id          uuid references public.vendors (id) on delete set null,
  paid_by_user_id    uuid references public.users (id) on delete set null,
  client             text,
  note               text,
  receipt_url        text,
  is_reimbursed      boolean not null default false,
  source             text not null default 'manual' check (source in ('manual','recurring')),
  recurring_id       uuid references public.recurring (id) on delete set null,
  created_by         uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists expenses_by_date on public.expenses (expense_date desc);
create index if not exists expenses_by_category on public.expenses (category_id);
create index if not exists expenses_by_payer on public.expenses (paid_by_user_id);

-- Existing projects need the column too (CREATE TABLE IF NOT EXISTS does not add it).
alter table public.expenses add column if not exists billing_month date;

-- Exact responsibility allocations. `amount` is in the parent expense currency;
-- `amount_npr` is frozen with the parent expense and powers settlements.
create table if not exists public.expense_shares (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  amount      numeric(14,2) not null check (amount >= 0),
  amount_npr  numeric(14,2) check (amount_npr >= 0),
  created_at  timestamptz not null default now(),
  unique (expense_id, user_id)
);
create index if not exists expense_shares_by_expense
  on public.expense_shares (expense_id);

-- Default split copied onto each real expense generated by a subscription.
-- It can be overridden in the "Mark paid" dialog for any particular month.
create table if not exists public.recurring_shares (
  id            uuid primary key default gen_random_uuid(),
  recurring_id  uuid not null references public.recurring (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  amount        numeric(14,2) not null check (amount >= 0),
  created_at    timestamptz not null default now(),
  unique (recurring_id, user_id)
);
create index if not exists recurring_shares_by_recurring
  on public.recurring_shares (recurring_id);

-- -----------------------------------------------------------------------------
-- settlements — "reimbursement X paid Y" rows that clear the who-owes-whom ledger
-- -----------------------------------------------------------------------------
create table if not exists public.settlements (
  id           uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.users (id) on delete cascade,
  to_user_id   uuid not null references public.users (id) on delete cascade,
  amount_npr   numeric(14,2) not null check (amount_npr > 0),
  settled_on   date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);


-- =============================================================================
-- Authentication and authorization
--
-- Nothing here. Sign-in used to run through Supabase Auth, which needed a
-- handle_new_user() trigger on auth.users and a set of RLS policies calling
-- auth.uid() / auth.jwt(). Those are gone: there is no auth schema and no
-- `authenticated` role in a plain Postgres database, so creating them made a
-- fresh install fail.
--
-- public.users is now the identity table (password_hash, is_admin -- added by
-- db/migrations/20260729_local_auth.sql), and authorization is enforced in the
-- application by requireSession() and requireAdmin() in src/lib/auth/server.ts.
-- =============================================================================

