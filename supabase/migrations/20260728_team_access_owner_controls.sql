-- Signed-in team members may view data and add tracking records.
-- Only Swornim may modify or delete existing records and protected settings.
-- Safe to run more than once in the Supabase SQL editor.

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
    execute format(
      'alter table public.%I enable row level security',
      target_table
    );

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

-- Team members can add new expenses, including their exact named shares.
create policy expenses_team_add on public.expenses
  for insert to authenticated
  with check (created_by = auth.uid());

create policy expense_shares_team_add on public.expense_shares
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.expenses
      where expenses.id = expense_shares.expense_id
        and expenses.created_by = auth.uid()
    )
  );

-- Adding tracking events is allowed; changing/removing existing rows remains
-- owner-only through the policies above.
create policy recurring_team_add on public.recurring
  for insert to authenticated with check (true);

create policy recurring_shares_team_add on public.recurring_shares
  for insert to authenticated with check (true);

notify pgrst, 'reload schema';
