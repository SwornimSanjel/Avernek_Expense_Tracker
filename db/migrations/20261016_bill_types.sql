-- =============================================================================
-- Bill types, and every bill counted as an expense exactly once.
--
--   * categories.counts_as_expense: false for spending that is not a company
--     expense (drinks, soft drinks, cigarettes, alcohol). Such money is still
--     recorded where it left an account, but it is kept out of company-expense
--     totals and is never offered as an expense to add.
--   * company_bills.category_id: what the bill is for (Food, Stationery,
--     Professional fees…). Drives the type tabs on the Bills page.
--   * company_bills.expense_id: the expense this bill is counted as. A bill
--     either created its expense or was linked to one already recorded, so the
--     same spending can never be counted twice.
--   * ai_audit_log kind 'receipt': reading a photo of a bill with AI, so its
--     token cost shows next to every other AI use.
--
-- Safe to run more than once. Nothing is deleted.
-- =============================================================================

alter table public.categories
  add column if not exists counts_as_expense boolean not null default true;

insert into public.categories (name, color, counts_as_expense)
values
  ('Drinks & smoke',    '#9f1239', false),
  ('Professional fees', '#0f766e', true)
on conflict (name) do nothing;

update public.categories set counts_as_expense = false where name = 'Drinks & smoke';

alter table public.company_bills
  add column if not exists category_id uuid references public.categories (id) on delete set null;
alter table public.company_bills
  add column if not exists expense_id uuid references public.expenses (id) on delete set null;

create unique index if not exists company_bills_one_per_expense
  on public.company_bills (expense_id) where expense_id is not null;
create index if not exists company_bills_by_category
  on public.company_bills (category_id, bill_date desc);

-- Best guess for bills saved before types existed; every one stays editable.
update public.company_bills b
   set category_id = c.id
  from public.categories c
 where b.category_id is null and c.name = 'Professional fees'
   and (b.description ~* '(lawyer|legal|advocate|audit|accountant|consult|registration fee)'
        or coalesce(b.vendor_name, '') ~* '(law|legal|audit|associates|advocate)');

update public.company_bills b
   set category_id = c.id
  from public.categories c
 where b.category_id is null and c.name = 'Drinks & smoke'
   and (b.description || ' ' || coalesce(b.vendor_name, ''))
       ~* '(beer|wine|whisk|vodka|alcohol|liquor|cigar|smok|tobacco|coke|pepsi|sprite|fanta|soft drink|red bull|energy drink|beverage)';

update public.company_bills b
   set category_id = c.id
  from public.categories c
 where b.category_id is null and c.name = 'Food'
   and (b.description || ' ' || coalesce(b.vendor_name, ''))
       ~* '(food|lunch|dinner|breakfast|khaja|momo|cafe|café|restaurant|snack|tea|coffee|bakery|kitchen|hotel)';

update public.company_bills b
   set category_id = c.id
  from public.categories c
 where b.category_id is null and c.name = 'Office Supplies'
   and (b.description || ' ' || coalesce(b.vendor_name, ''))
       ~* '(stationer|paper|print|pen\M|notebook|photocop|xerox|toner|ink)';

do $$
begin
  if to_regclass('public.ai_audit_log') is not null then
    alter table public.ai_audit_log drop constraint if exists ai_audit_log_kind_check;
    alter table public.ai_audit_log
      add constraint ai_audit_log_kind_check
      check (kind in ('chat', 'tool', 'form', 'confirm', 'transcription', 'receipt'));
  end if;
end $$;
