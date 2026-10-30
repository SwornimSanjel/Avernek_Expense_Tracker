-- =============================================================================
-- 1. What each person may view
--
--   users.access: null means "everything" (how every account worked so far).
--   Otherwise {"sections": [...], "expenses": [...]}: the pages they may open
--   and which expenses they see — "vat" (VAT account), "non_vat" (the
--   personal / non-VAT company accounts), "founder" (paid by a partner
--   personally). Administrators always see everything. See src/lib/access.ts.
--
-- 2. Removing someone keeps their history
--
--   users.removed_at: set when an administrator removes a person. It only ends
--   their sign-in; the row stays, so every expense, split, contribution and
--   investment that names them keeps adding up exactly as before.
--
--   The foreign keys that carry money history used to CASCADE or SET NULL,
--   so deleting a user row would have silently erased their splits and
--   contributions and blanked "paid by". They now RESTRICT: the database
--   refuses to delete anyone who has history.
--
-- Safe to run more than once. Nothing is deleted.
-- =============================================================================

alter table public.users add column if not exists access jsonb;
alter table public.users add column if not exists removed_at timestamptz;

do $$
declare
  target record;
  existing record;
begin
  for target in
    select * from (values
      ('public.expense_shares',   'user_id',         'expense_shares_user_id_fkey'),
      ('public.recurring_shares', 'user_id',         'recurring_shares_user_id_fkey'),
      ('public.settlements',      'from_user_id',    'settlements_from_user_id_fkey'),
      ('public.settlements',      'to_user_id',      'settlements_to_user_id_fkey'),
      ('public.expenses',         'paid_by_user_id', 'expenses_paid_by_user_id_fkey'),
      ('public.recurring',        'paid_by_user_id', 'recurring_paid_by_user_id_fkey')
    ) as t(table_name, column_name, constraint_name)
  loop
    -- Drop every foreign key from this column to users, whatever it is named.
    for existing in
      select c.conname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f'
         and c.conrelid = target.table_name::regclass
         and c.confrelid = 'public.users'::regclass
         and a.attname = target.column_name
    loop
      execute format('alter table %s drop constraint %I', target.table_name, existing.conname);
    end loop;

    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.users (id) on delete restrict',
      target.table_name, target.constraint_name, target.column_name
    );
  end loop;
end $$;
