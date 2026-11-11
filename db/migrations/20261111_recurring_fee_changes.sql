-- =============================================================================
-- Monthly fee changes.
--
-- A client's monthly fee can change part-way through a contract (service
-- reduced, price renegotiated). The fee in recurring_amount stays the STARTING
-- fee; each change says "from this month, the fee is X". Months before a change
-- keep the price they had, so history and old balances never move.
--
--   [{ "stream": "combined", "from": "2026-12-05", "amount": 20000,
--      "note": "Reduced service", "changed_on": "2026-11-11" }]
--
-- Written and validated by the app (changeMonthlyFee); the activity-log trigger
-- on income_agreements records every change. Safe to run more than once.
-- =============================================================================

alter table public.income_agreements
  add column if not exists recurring_fee_changes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_agreements_fee_changes_array'
      and conrelid = 'public.income_agreements'::regclass
  ) then
    alter table public.income_agreements
      add constraint income_agreements_fee_changes_array
      check (jsonb_typeof(recurring_fee_changes) = 'array');
  end if;
end $$;
