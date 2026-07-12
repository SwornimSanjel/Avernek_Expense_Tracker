-- Make expense participants independent from authentication and add the default team.
-- Safe to run more than once in the Supabase SQL editor.

alter table public.users drop constraint if exists users_id_fkey;
alter table public.users alter column id set default gen_random_uuid();

-- Also ensure the monthly allocation feature exists. Keeping this migration
-- self-contained avoids a required ordering between the two July migrations.
alter table public.expenses add column if not exists billing_month date;

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

alter table public.expense_shares enable row level security;
alter table public.recurring_shares enable row level security;

drop policy if exists expense_shares_rw on public.expense_shares;
create policy expense_shares_rw on public.expense_shares
  for all to authenticated using (true) with check (true);

drop policy if exists recurring_shares_rw on public.recurring_shares;
create policy recurring_shares_rw on public.recurring_shares
  for all to authenticated using (true) with check (true);

insert into public.users (id, name, email, is_core_member)
select '00000000-0000-4000-8000-000000000101', 'Swornim', 'swornim@local.expense', true
where not exists (select 1 from public.users where lower(name) like 'swornim%');

insert into public.users (id, name, email, is_core_member)
select '00000000-0000-4000-8000-000000000102', 'Pragyan', 'pragyan@local.expense', true
where not exists (select 1 from public.users where lower(name) like 'pragyan%');

insert into public.users (id, name, email, is_core_member)
select '00000000-0000-4000-8000-000000000103', 'Sushant', 'sushant@local.expense', true
where not exists (select 1 from public.users where lower(name) like 'sushant%');

update public.users set is_core_member = true
where lower(name) like 'swornim%'
   or lower(name) like 'pragyan%'
   or lower(name) like 'sushant%';

-- Remove the former unused default participant if an earlier version added him.
delete from public.users
where id = '00000000-0000-4000-8000-000000000104'
  and email = 'bhuraj@local.expense';

notify pgrst, 'reload schema';
