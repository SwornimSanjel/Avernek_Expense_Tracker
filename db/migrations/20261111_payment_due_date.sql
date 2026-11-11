-- =============================================================================
-- When a payment SHOULD have been paid, next to when it was paid (paid_on).
--
-- Optional and editable at any time: clients pause, come back and pay late, so
-- the real due date is often agreed after the fact. When set on a monthly
-- payment it also becomes that month's due date (for overdue checks). Lateness
-- (paid_on − due_on) is derived, never stored. Safe to run more than once.
-- =============================================================================

alter table public.income_payments
  add column if not exists due_on date;
