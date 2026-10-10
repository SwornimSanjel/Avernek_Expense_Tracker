-- =============================================================================
-- Whether a client deducts 1.5% TDS when paying. Used to show what will reach
-- the bank for each agreed price and to pre-select TDS on new payments.
-- Safe to run more than once.
-- =============================================================================

alter table public.income_agreements
  add column if not exists deducts_tds boolean not null default false;

-- Clients that already had TDS withheld on a payment keep that behaviour.
update public.income_agreements a
   set deducts_tds = true
 where deducts_tds = false
   and exists (
     select 1 from public.income_payments p
      where p.agreement_id = a.id and p.tds_amount > 0
   );
