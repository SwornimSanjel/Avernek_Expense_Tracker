-- =============================================================================
-- Client income tracking: agreements, billing anchors and received payments.
-- Safe to run more than once.
-- =============================================================================

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

alter table public.income_agreements
  add column if not exists service_end_date date;

alter table public.income_agreements
  add column if not exists service_type text not null default 'full_track';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_service_type_check'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_service_type_check
      check (service_type in ('ai_automation','marketing','full_track'));
  end if;
end $$;

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
