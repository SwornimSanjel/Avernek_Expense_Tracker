-- =============================================================================
-- Simpler client dates, VAT / TDS on receipts, VAT bills & reimbursements,
-- VAT deposits, and income that does not belong to a client agreement.
--
-- WHAT CHANGES
--   * Client dates collapse to the ones that exist on paper:
--       contract signed  -> agreement_date (unchanged)
--       work started     -> work_start_date (new, optional)
--       Day 1 / go-live  -> recurring_billing_start_date (unchanged meaning:
--                           month 1 is the setup charge, recurring from month 2)
--       website start / delivered -> website_start_date / website_completed_date
--     setup_due_date becomes nullable: a setup charge is due on Day 1, and
--     Day 1 is unknown until ads / automation actually launch.
--   * Every receipt splits into the bill amount (revenue, settles the client's
--     balance), VAT collected on top (owed to IRD, never spendable) and TDS the
--     client withheld (never reached the bank, claimable against income tax).
--   * company_bills: bills in Avernek's name (lawyer, rent...) that someone
--     paid first and the VAT account reimburses. Their VAT is input VAT.
--   * money_transfers gains kind = 'reimbursement' linked to a company bill.
--   * tax_payments: VAT deposited to IRD.
--   * other_income: revenue with no client agreement (one-off jobs, extra work).
--
-- DATA SAFETY: nothing is dropped or deleted. Safe to run more than once.
-- =============================================================================

-- 1. Client dates ---------------------------------------------------------------
alter table public.income_agreements
  add column if not exists work_start_date date;

alter table public.income_agreements alter column setup_due_date drop not null;

update public.income_agreements
   set work_start_date = coalesce(ads_prep_start_date, website_start_date)
 where work_start_date is null
   and coalesce(ads_prep_start_date, website_start_date) is not null;

-- 2. VAT and TDS on client receipts -------------------------------------------
alter table public.income_payments
  add column if not exists vat_amount numeric(14,2) not null default 0;
alter table public.income_payments
  add column if not exists tds_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_payments_tax_check'
      and conrelid = 'public.income_payments'::regclass
  ) then
    alter table public.income_payments
      add constraint income_payments_tax_check
      check (vat_amount >= 0 and tds_amount >= 0 and tds_amount <= amount + vat_amount);
  end if;
end $$;

-- 3. Income without a client agreement ----------------------------------------
create table if not exists public.other_income (
  id               uuid primary key default gen_random_uuid(),
  money_account_id uuid not null references public.money_accounts (id) on delete restrict,
  category         text not null default 'other'
                     check (category in ('website_project','extra_work','consulting','commission','other')),
  source_name      text,
  description      text not null,
  amount           numeric(14,2) not null check (amount > 0),
  vat_amount       numeric(14,2) not null default 0 check (vat_amount >= 0),
  tds_amount       numeric(14,2) not null default 0 check (tds_amount >= 0),
  received_on      date not null default current_date,
  method           text check (method is null or method in ('bank_transfer','cash','cheque','wallet','card','other')),
  reference        text,
  note             text,
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  check (tds_amount <= amount + vat_amount)
);

create index if not exists other_income_by_account
  on public.other_income (money_account_id, received_on desc);

-- 4. Bills in the company's name, waiting to be reimbursed ----------------------
create table if not exists public.company_bills (
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  vendor_name   text,
  bill_number   text,
  bill_date     date not null default current_date,
  total_amount  numeric(14,2) not null check (total_amount > 0),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  paid_by       text,
  note          text,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (vat_amount <= total_amount)
);

alter table public.money_transfers
  add column if not exists kind text not null default 'transfer';
alter table public.money_transfers
  add column if not exists bill_id uuid references public.company_bills (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'money_transfers_kind_check'
      and conrelid = 'public.money_transfers'::regclass
  ) then
    alter table public.money_transfers
      add constraint money_transfers_kind_check
      check (kind in ('transfer','reimbursement'));
  end if;
end $$;

create index if not exists money_transfers_by_bill
  on public.money_transfers (bill_id);

-- 5. VAT deposited to the Inland Revenue Department ------------------------------
create table if not exists public.tax_payments (
  id               uuid primary key default gen_random_uuid(),
  tax_type         text not null default 'vat' check (tax_type in ('vat')),
  money_account_id uuid not null references public.money_accounts (id) on delete restrict,
  amount           numeric(14,2) not null check (amount > 0),
  paid_on          date not null default current_date,
  period_label     text,
  reference        text,
  note             text,
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists tax_payments_by_account
  on public.tax_payments (money_account_id, paid_on desc);
