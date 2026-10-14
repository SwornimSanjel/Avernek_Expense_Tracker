-- Monthly billing labels and exact per-person subscription/expense shares.
-- Safe to run more than once in the Supabase SQL editor.

alter table public.expenses
  add column if not exists billing_month date;

create table if not exists public.expense_shares (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  amount      numeric(14,2) not null check (amount >= 0),
  amount_npr  numeric(14,2) check (amount_npr >= 0),
  created_at  timestamptz not null default now(),
  unique (expense_id, user_id)
);

create table if not exists public.recurring_shares (
  id            uuid primary key default gen_random_uuid(),
  recurring_id  uuid not null references public.recurring (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  amount        numeric(14,2) not null check (amount >= 0),
  created_at    timestamptz not null default now(),
  unique (recurring_id, user_id)
);

create index if not exists expense_shares_by_expense
  on public.expense_shares (expense_id);
create index if not exists recurring_shares_by_recurring
  on public.recurring_shares (recurring_id);

alter table public.expense_shares enable row level security;
alter table public.recurring_shares enable row level security;

-- Make PostgREST notice the new tables immediately.
notify pgrst, 'reload schema';

-- RLS policies removed: they targeted the `authenticated` role, which exists
-- only in Supabase and made this migration fail on a plain Postgres database.
-- Access is enforced in application code now — see src/lib/auth/server.ts.
