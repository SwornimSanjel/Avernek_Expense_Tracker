-- =============================================================================
-- A bill whose spending is already in Expenses in a way that cannot be linked
-- one-to-one (for example one combined "food this week" expense). Marking it
-- counted keeps it off the "Not in expenses" list without adding any money.
-- Safe to run more than once.
-- =============================================================================

alter table public.company_bills
  add column if not exists counted_elsewhere boolean not null default false;
