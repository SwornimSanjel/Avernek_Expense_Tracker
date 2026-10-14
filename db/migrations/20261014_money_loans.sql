-- =============================================================================
-- Company money lent to a person (e.g. a founder borrowing from the non-VAT
-- account), and when it came back.
--
-- Lending is not an expense and repaying is not income: the money leaves the
-- account on the day it is lent and returns when it is paid back. Nothing here
-- touches revenue, expenses, VAT or profit — only the account balance.
--
-- No due date and no interest by design: just who, how much, from which
-- account, when — and whether it has been paid back.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.money_loans (
  id                   uuid primary key default gen_random_uuid(),
  money_account_id     uuid not null references public.money_accounts (id) on delete restrict,
  borrower_name        text not null,
  amount               numeric(14,2) not null check (amount > 0),
  lent_on              date not null default current_date,
  note                 text,
  repaid_on            date,
  repaid_to_account_id uuid references public.money_accounts (id) on delete restrict,
  created_by           uuid references public.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_by           uuid references public.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  -- Repaid means both: the day it came back and the account it came back to.
  constraint money_loans_repaid_check check (
    (repaid_on is null and repaid_to_account_id is null)
    or (repaid_on is not null and repaid_to_account_id is not null and repaid_on >= lent_on)
  )
);

create index if not exists money_loans_by_account
  on public.money_loans (money_account_id, lent_on desc);
create index if not exists money_loans_outstanding
  on public.money_loans (lent_on desc) where repaid_on is null;
