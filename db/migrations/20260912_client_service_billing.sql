-- =============================================================================
-- Service-based client billing.
--
-- WHAT CHANGES
--   * A client buys any combination of Website / Ads / AI automation instead of
--     one of three hard-coded packages.
--   * Ads-live and automation-live become two separate, NULLABLE dates: a client
--     signs and pays weeks before the service actually goes live.
--   * Recurring billing is anchored on its own editable date
--     (recurring_billing_start_date), never on the agreement or payment date.
--   * Website is one-off project billing with its own price, dates and payments.
--   * Money received into an account is separated from revenue: founder capital
--     and other non-revenue inflows live in their own ledger (capital_inflows)
--     so nobody ever has to invent a fake client to correct a bank balance.
--
-- DATA SAFETY
--   Nothing is dropped and nothing is deleted. Every existing agreement keeps
--   its amounts, dates and payments; the old ads_live_date is copied into the
--   service and billing columns whose meaning it already had.
--
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Services purchased. Any combination; at least one is enforced in the app
--    layer so legacy rows can never fail the constraint.
-- -----------------------------------------------------------------------------
alter table public.income_agreements
  add column if not exists has_website    boolean not null default false;
alter table public.income_agreements
  add column if not exists has_ads        boolean not null default false;
alter table public.income_agreements
  add column if not exists has_automation boolean not null default false;

-- service_type is kept as a legacy mirror of the three flags (old exports and
-- SQL reports still read it). The app writes it from the flags and never reads
-- it back, so the two can not disagree. 'website' and 'custom' are new values
-- for combinations the old enum could not express.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_service_type_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      drop constraint income_agreements_service_type_check;
  end if;

  alter table public.income_agreements
    add constraint income_agreements_service_type_check
    check (service_type in ('ai_automation','marketing','full_track','website','custom'));
end $$;

-- -----------------------------------------------------------------------------
-- 2. Agreement header: pending/cancelled statuses, optional contract end,
--    default receiving account (which is what VAT / non-VAT means here).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_status_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements drop constraint income_agreements_status_check;
  end if;

  alter table public.income_agreements
    add constraint income_agreements_status_check
    check (status in ('active','pending','paused','completed','cancelled'));
end $$;

alter table public.income_agreements
  add column if not exists contract_end_date date;
alter table public.income_agreements
  add column if not exists default_money_account_id uuid
    references public.money_accounts (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. Setup / initial billing. The date the setup balance reached zero is
--    derived from the payments; this column only exists so an admin can correct
--    it when the real-world date differs from the recorded one.
-- -----------------------------------------------------------------------------
alter table public.income_agreements
  add column if not exists setup_paid_in_full_date date;
alter table public.income_agreements
  add column if not exists setup_notes text;

-- -----------------------------------------------------------------------------
-- 4. Website: one-off project billing.
-- -----------------------------------------------------------------------------
alter table public.income_agreements
  add column if not exists website_amount numeric(14,2) not null default 0;
alter table public.income_agreements
  add column if not exists website_status text not null default 'not_started';
alter table public.income_agreements
  add column if not exists website_start_date date;
alter table public.income_agreements
  add column if not exists website_expected_date date;
alter table public.income_agreements
  add column if not exists website_completed_date date;
alter table public.income_agreements
  add column if not exists website_due_date date;
alter table public.income_agreements
  add column if not exists website_paid_in_full_date date;
alter table public.income_agreements
  add column if not exists website_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_website_amount_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_website_amount_check check (website_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_website_status_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_website_status_check
      check (website_status in ('not_started','in_progress','review','completed','on_hold','cancelled'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Ads and AI automation, tracked separately because they rarely go live on
--    the same day. Both live dates are nullable: "not live yet" is a normal,
--    valid state for a client who has already signed and paid.
-- -----------------------------------------------------------------------------
alter table public.income_agreements alter column ads_live_date drop not null;

alter table public.income_agreements
  add column if not exists ads_status text not null default 'not_started';
alter table public.income_agreements
  add column if not exists ads_prep_start_date date;
alter table public.income_agreements
  add column if not exists ads_monthly_amount numeric(14,2);
alter table public.income_agreements
  add column if not exists ads_billing_start_date date;
alter table public.income_agreements
  add column if not exists ads_notes text;

alter table public.income_agreements
  add column if not exists automation_status text not null default 'not_started';
alter table public.income_agreements
  add column if not exists automation_live_date date;
alter table public.income_agreements
  add column if not exists automation_monthly_amount numeric(14,2);
alter table public.income_agreements
  add column if not exists automation_billing_start_date date;
alter table public.income_agreements
  add column if not exists automation_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_ads_status_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_ads_status_check
      check (ads_status in ('not_started','preparation','ready','live','paused','stopped'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_automation_status_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_automation_status_check
      check (automation_status in ('not_started','development','testing','ready','live','paused','stopped'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_ads_monthly_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_ads_monthly_check
      check (ads_monthly_amount is null or ads_monthly_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_automation_monthly_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_automation_monthly_check
      check (automation_monthly_amount is null or automation_monthly_amount >= 0);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Recurring billing anchor. 'combined' bills ads + automation as one monthly
--    fee (the mode this workspace already used); 'separate' bills each service
--    on its own amount and its own start date.
--
--    setup_covers_first_cycle preserves the existing convention: the setup /
--    first-month fee pays for the cycle that begins on the billing start date,
--    so the first recurring invoice falls one calendar month later. Turn it off
--    for a client whose setup fee was something else (a website build, say).
-- -----------------------------------------------------------------------------
alter table public.income_agreements
  add column if not exists recurring_billing_mode text not null default 'combined';
alter table public.income_agreements
  add column if not exists recurring_billing_start_date date;
alter table public.income_agreements
  add column if not exists setup_covers_first_cycle boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_recurring_mode_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_recurring_mode_check
      check (recurring_billing_mode in ('combined','separate'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Payments: website payments, which recurring stream a payment belongs to,
--    how the money arrived, and who last touched the record.
-- -----------------------------------------------------------------------------
alter table public.income_payments
  add column if not exists billing_stream text;
alter table public.income_payments
  add column if not exists method text;
alter table public.income_payments
  add column if not exists updated_at timestamptz not null default now();
alter table public.income_payments
  add column if not exists updated_by uuid references public.users (id) on delete set null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'income_payments_payment_for_check'
      and conrelid = 'public.income_payments'::regclass
  ) then
    alter table public.income_payments drop constraint income_payments_payment_for_check;
  end if;

  alter table public.income_payments
    add constraint income_payments_payment_for_check
    check (payment_for in ('setup','recurring','website'));

  if exists (
    select 1 from pg_constraint
    where conname = 'income_payment_period_check'
      and conrelid = 'public.income_payments'::regclass
  ) then
    alter table public.income_payments drop constraint income_payment_period_check;
  end if;

  -- Only a recurring payment belongs to a billing period and a stream.
  alter table public.income_payments
    add constraint income_payment_period_check check (
      (payment_for in ('setup','website') and billing_period_start is null)
      or (payment_for = 'recurring' and billing_period_start is not null)
    );

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_payments_stream_check'
      and conrelid = 'public.income_payments'::regclass
  ) then
    alter table public.income_payments
      add constraint income_payments_stream_check
      check (billing_stream is null or billing_stream in ('combined','ads','automation'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'income_payments_method_check'
      and conrelid = 'public.income_payments'::regclass
  ) then
    alter table public.income_payments
      add constraint income_payments_method_check
      check (method is null or method in ('bank_transfer','cash','cheque','wallet','card','other'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Non-revenue money in: founder capital, owner contributions, loans.
--
--    This is the whole point of the separation. These rows move an account
--    balance but are NEVER client income, sales, service revenue, VAT-taxable
--    sales or profit. They carry no client and no agreement on purpose.
-- -----------------------------------------------------------------------------
create table if not exists public.capital_inflows (
  id               uuid primary key default gen_random_uuid(),
  money_account_id uuid not null references public.money_accounts (id) on delete restrict,
  inflow_type      text not null
                     check (inflow_type in ('founder_investment','owner_contribution',
                                            'loan_received','other_non_revenue')),
  amount           numeric(14,2) not null check (amount > 0),
  received_on      date not null default current_date,
  source_name      text,
  reference        text,
  note             text,
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.users (id) on delete set null,
  updated_at       timestamptz not null default now()
);

create index if not exists capital_inflows_by_account
  on public.capital_inflows (money_account_id, received_on desc);

-- -----------------------------------------------------------------------------
-- 9. Backfill. Runs once: every branch is guarded so a re-run changes nothing.
--
--    old service_type   -> services purchased
--      ai_automation    -> AI automation
--      marketing        -> Ads / marketing
--      full_track       -> Ads / marketing + AI automation
--
--    The old ads_live_date was labelled "ads / automation live · Service Day 1"
--    and was the recurring billing anchor, so it is copied to exactly the
--    columns that already carried its meaning — never guessed at.
-- -----------------------------------------------------------------------------
update public.income_agreements
   set has_ads        = service_type in ('marketing','full_track'),
       has_automation = service_type in ('ai_automation','full_track')
 where has_ads = false and has_automation = false and has_website = false;

update public.income_agreements
   set automation_live_date = ads_live_date
 where has_automation = true
   and automation_live_date is null
   and ads_live_date is not null;

update public.income_agreements
   set recurring_billing_start_date = ads_live_date
 where recurring_billing_start_date is null
   and ads_live_date is not null;

update public.income_agreements
   set ads_status = case
         when ads_live_date is null then 'not_started'
         when ads_live_date <= current_date then 'live'
         else 'ready'
       end
 where has_ads = true and ads_status = 'not_started';

update public.income_agreements
   set automation_status = case
         when automation_live_date is null then 'not_started'
         when automation_live_date <= current_date then 'live'
         else 'ready'
       end
 where has_automation = true and automation_status = 'not_started';

-- Every recurring payment recorded so far was for the single combined fee.
update public.income_payments
   set billing_stream = 'combined'
 where payment_for = 'recurring' and billing_stream is null;

-- The receiving account already on the payments is the client's usual account.
update public.income_agreements a
   set default_money_account_id = p.money_account_id
  from (
    select distinct on (agreement_id) agreement_id, money_account_id
      from public.income_payments
     where money_account_id is not null
     order by agreement_id, paid_on desc, created_at desc
  ) p
 where p.agreement_id = a.id
   and a.default_money_account_id is null;
