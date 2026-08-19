-- =============================================================================
-- Company funds held across official, custody and wallet accounts.
-- Safe to run more than once.
-- =============================================================================

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

update public.money_accounts
   set name = 'Swornim Sanjel · Global IME (company money · non-VAT)',
       holder_name = 'Swornim Sanjel',
       notes = 'Personally held Global IME account reserved only for Avernek company money from clients who do not need a VAT bill.'
 where name = 'Swornim · Global IME (company funds)'
   and currency = 'NPR';

update public.money_accounts
   set name = 'Avernek Technologies Pvt. Ltd. · Global IME (company account · VAT)',
       holder_name = 'Avernek Technologies Pvt. Ltd.',
       notes = 'Official Global IME company account for client payments that need a VAT bill.'
 where name = 'Avernek company bank (VAT receipts)'
   and currency = 'NPR';

insert into public.money_accounts (name, kind, currency, holder_name, notes)
values
  ('Swornim Sanjel · Global IME (company money · non-VAT)', 'personal_custody', 'NPR', 'Swornim Sanjel',
   'Personally held Global IME account reserved only for Avernek company money from clients who do not need a VAT bill.'),
  ('Avernek Technologies Pvt. Ltd. · Global IME (company account · VAT)', 'company_bank', 'NPR', 'Avernek Technologies Pvt. Ltd.',
   'Official Global IME company account for client payments that need a VAT bill.')
on conflict (name, currency) do nothing;

alter table public.expenses
  -- The default intentionally classifies every existing historical expense as
  -- founder/team investment when this migration is applied to the old database.
  add column if not exists funding_source text not null default 'personal';
alter table public.expenses
  add column if not exists money_account_id uuid references public.money_accounts (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_funding_source_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_funding_source_check
      check (funding_source in ('personal','company_funds'));
  end if;
end $$;

-- One expense must belong to exactly one money ledger: either founder/team
-- money with no bank-account debit, or company money with a named account.
update public.expenses
set money_account_id = null
where funding_source = 'personal' and money_account_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_money_ledger_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_money_ledger_check
      check (
        (funding_source = 'personal' and money_account_id is null)
        or
        (funding_source = 'company_funds' and money_account_id is not null)
      );
  end if;
end $$;

alter table public.income_payments
  add column if not exists money_account_id uuid references public.money_accounts (id) on delete set null;

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

create index if not exists expenses_by_money_account
  on public.expenses (money_account_id, expense_date desc);
create index if not exists income_payments_by_money_account
  on public.income_payments (money_account_id, paid_on desc);
create index if not exists money_transfers_by_date
  on public.money_transfers (transfer_date desc);
