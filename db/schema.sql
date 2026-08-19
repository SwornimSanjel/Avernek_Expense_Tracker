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

-- Company-owned money may sit in an official bank, a personal-custody account,
-- a digital wallet, or cash. The holder is not the economic owner.
create table if not exists public.money_accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('company_bank','personal_custody','digital_wallet','cash')),
  currency    text not null check (currency in ('NPR','USD')),
  holder_name text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (name, currency)
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
  funding_source     text not null default 'personal'
                       check (funding_source in ('personal','company_funds')),
  money_account_id   uuid references public.money_accounts (id) on delete set null,
  client             text,
  note               text,
  receipt_url        text,
  is_reimbursed      boolean not null default false,
  source             text not null default 'manual' check (source in ('manual','recurring')),
  recurring_id       uuid references public.recurring (id) on delete set null,
  created_by         uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint expenses_money_ledger_check check (
    (funding_source = 'personal' and money_account_id is null)
    or
    (funding_source = 'company_funds' and money_account_id is not null)
  )
);
create index if not exists expenses_by_date on public.expenses (expense_date desc);
create index if not exists expenses_by_category on public.expenses (category_id);
create index if not exists expenses_by_payer on public.expenses (paid_by_user_id);
create index if not exists expenses_by_money_account
  on public.expenses (money_account_id, expense_date desc);

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

-- Client agreements and money received. Ads-live is service day 1; recurring
-- obligations begin every exact 30 days because the setup fee covers cycle one.
create table if not exists public.income_agreements (
  id                        uuid primary key default gen_random_uuid(),
  client_name               text not null,
  agreement_name            text,
  service_type              text not null default 'full_track'
                              check (service_type in ('ai_automation','marketing','full_track')),
  contact_name              text,
  agreement_date            date not null,
  ads_live_date             date not null,
  setup_amount              numeric(14,2) not null default 0 check (setup_amount >= 0),
  recurring_amount          numeric(14,2) not null default 0 check (recurring_amount >= 0),
  currency                  text not null default 'NPR' check (currency in ('NPR','USD')),
  setup_payment_terms       text not null default 'full_upfront'
                              check (setup_payment_terms in ('full_upfront','half_advance','custom')),
  setup_advance_percent     numeric(5,2) not null default 50
                              check (setup_advance_percent >= 0 and setup_advance_percent <= 100),
  setup_due_date            date not null,
  recurring_due_days_before integer not null default 0
                              check (recurring_due_days_before >= 0 and recurring_due_days_before <= 30),
  status                    text not null default 'active'
                              check (status in ('active','paused','completed')),
  service_end_date          date,
  notes                     text,
  created_by                uuid references public.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists income_agreements_by_client
  on public.income_agreements (client_name);
create index if not exists income_agreements_by_status
  on public.income_agreements (status);

create table if not exists public.income_payments (
  id                   uuid primary key default gen_random_uuid(),
  agreement_id         uuid not null references public.income_agreements (id) on delete cascade,
  payment_for          text not null check (payment_for in ('setup','recurring')),
  billing_period_start date,
  amount               numeric(14,2) not null check (amount > 0),
  paid_on              date not null,
  received_in          text not null check (received_in in ('company','personal')),
  money_account_id     uuid references public.money_accounts (id) on delete set null,
  account_name         text,
  reference            text,
  note                 text,
  recorded_by          uuid references public.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint income_payment_period_check check (
    (payment_for = 'setup' and billing_period_start is null)
    or (payment_for = 'recurring' and billing_period_start is not null)
  )
);
create index if not exists income_payments_by_agreement
  on public.income_payments (agreement_id, paid_on desc);
create index if not exists income_payments_by_period
  on public.income_payments (agreement_id, billing_period_start);

-- Moving money between accounts is not income or an expense. Both sides are
-- stored so NPR -> USD exchanges preserve the remaining balance in each unit.
create table if not exists public.money_transfers (
  id              uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references public.money_accounts (id) on delete restrict,
  to_account_id   uuid not null references public.money_accounts (id) on delete restrict,
  from_amount     numeric(14,2) not null check (from_amount > 0),
  to_amount       numeric(14,2) not null check (to_amount > 0),
  transfer_date   date not null default current_date,
  note            text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index if not exists money_transfers_by_date
  on public.money_transfers (transfer_date desc);


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
