-- =============================================================================
-- Old bills were uploaded after their spending had already been typed into
-- Expenses by hand, so none of them is "missing" from Expenses.
--
--   1. Link every bill to the one expense that clearly is the same spending
--      (NPR, same amount within 1%, within 10 days, and that expense matches
--      no other bill).
--   2. Mark every other bill not linked yet as counted elsewhere.
--
-- Only the link/flag columns change: no expense is added or removed and no
-- balance moves. Safe to run more than once.
-- =============================================================================

with candidates as (
  select b.id as bill_id,
         e.id as expense_id,
         count(*) over (partition by b.id) as per_bill,
         count(*) over (partition by e.id) as per_expense
    from public.company_bills b
    join public.expenses e
      on e.currency = 'NPR'
     and abs(coalesce(e.amount_npr, e.amount) - b.total_amount) <= greatest(2, b.total_amount * 0.01)
     and abs(e.expense_date - b.bill_date) <= 10
   where b.expense_id is null
     and not b.counted_elsewhere
     and not exists (select 1 from public.company_bills other where other.expense_id = e.id)
)
update public.company_bills b
   set expense_id = c.expense_id, updated_at = now()
  from candidates c
 where c.bill_id = b.id and c.per_bill = 1 and c.per_expense = 1;

update public.company_bills
   set counted_elsewhere = true, updated_at = now()
 where expense_id is null and not counted_elsewhere;
