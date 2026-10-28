-- =============================================================================
-- 1. Bills on expenses
--
--   * expenses.has_bill: the answer to "Do you have a bill?" when the expense
--     was added. Null for expenses saved before the question existed.
--   * expenses.bill_number / expenses.seller_pan: the bill's number and the
--     seller's PAN or VAT number (9 digits), asked only when there is a bill.
--
-- 2. Churned clients
--
--   income_agreements.status 'churned': the client left. Nothing they still
--   owed counts as due or overdue any more; their payments stay on record.
--
-- Safe to run more than once. Nothing is deleted.
-- =============================================================================

alter table public.expenses add column if not exists has_bill boolean;
alter table public.expenses add column if not exists bill_number text;
alter table public.expenses add column if not exists seller_pan text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_seller_pan_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_seller_pan_check
      check (seller_pan is null or seller_pan ~ '^[0-9]{9}$');
  end if;
end $$;

alter table public.income_agreements drop constraint if exists income_agreements_status_check;
alter table public.income_agreements
  add constraint income_agreements_status_check
  check (status in ('active','pending','paused','completed','cancelled','churned'));
