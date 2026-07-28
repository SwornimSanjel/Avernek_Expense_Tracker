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
-- Signed-in users are still auto-created by handle_new_user().
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
-- Auth trigger: create a public.users row whenever someone signs up.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, is_core_member)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row Level Security
-- Single internal workspace: any signed-in team member can read/write everything.
-- =============================================================================
alter table public.users       enable row level security;
alter table public.categories  enable row level security;
alter table public.vendors     enable row level security;
alter table public.fx_rates    enable row level security;
alter table public.recurring   enable row level security;
alter table public.expenses    enable row level security;
alter table public.expense_shares enable row level security;
alter table public.recurring_shares enable row level security;
alter table public.settlements enable row level security;

-- Signed-in team members may view data and add tracking records. Only Swornim
-- may modify/delete existing rows or protected settings.
do $$
declare
  target_table text;
  existing_policy record;
  owner_email constant text := 'xettrikenzon@gmail.com';
begin
  foreach target_table in array array[
    'users',
    'categories',
    'vendors',
    'fx_rates',
    'recurring',
    'expenses',
    'expense_shares',
    'recurring_shares',
    'settlements'
  ]
  loop
    for existing_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
    loop
      execute format(
        'drop policy %I on public.%I',
        existing_policy.policyname,
        target_table
      );
    end loop;

    execute format(
      'create policy %I on public.%I
         for select to authenticated using (true)',
      target_table || '_team_read',
      target_table
    );

    execute format(
      'create policy %I on public.%I
         for all to authenticated
         using (lower(coalesce(auth.jwt() ->> ''email'', '''')) = %L)
         with check (lower(coalesce(auth.jwt() ->> ''email'', '''')) = %L)',
      target_table || '_owner_manage',
      target_table,
      owner_email,
      owner_email
    );
  end loop;
end $$;

create policy expenses_team_add on public.expenses
  for insert to authenticated
  with check (created_by = auth.uid());

create policy expense_shares_team_add on public.expense_shares
  for insert to authenticated
  with check (
    exists (
      select 1 from public.expenses
      where expenses.id = expense_shares.expense_id
        and expenses.created_by = auth.uid()
    )
  );

create policy recurring_team_add on public.recurring
  for insert to authenticated with check (true);

create policy recurring_shares_team_add on public.recurring_shares
  for insert to authenticated with check (true);

notify pgrst, 'reload schema';
