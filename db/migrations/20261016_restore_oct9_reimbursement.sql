-- One-time repair, 16 Oct 2026.
--
-- On 9 Oct 2026 the VAT account paid NPR 20,340 back to the Non-VAT account
-- for the lawyer's company-incorporation bill (Summit Legal Advisory). The
-- record of that payment was deleted while old bills were being cleaned up,
-- so the Non-VAT account showed 20,340 too little and the VAT account 20,340
-- too much (the total was unchanged). The money really moved: this puts the
-- record back and links it to the re-added Summit Legal bill.
--
-- It changes nothing when:
--   * a 20,340 movement from the VAT account to the Non-VAT account already
--     exists (on any date), e.g. re-entered by hand; or
--   * the VAT and Non-VAT accounts cannot be told apart (not exactly one each).
-- Safe to run more than once.
insert into public.money_transfers
  (kind, bill_id, from_account_id, to_account_id, from_amount, to_amount, transfer_date, note)
select
  'reimbursement',
  (select b.id from public.company_bills b
    where b.total_amount = 20340 and b.bill_date = '2026-09-22'
    order by b.created_at desc limit 1),
  vat.id,
  nonvat.id,
  20340,
  20340,
  date '2026-10-09',
  'Reimbursed: Summit Legal Advisory · company incorporation (record restored)'
from
  (select id from public.money_accounts where kind = 'company_bank' and currency = 'NPR') vat,
  (select id from public.money_accounts where kind = 'personal_custody' and currency = 'NPR') nonvat
where (select count(*) from public.money_accounts where kind = 'company_bank' and currency = 'NPR') = 1
  and (select count(*) from public.money_accounts where kind = 'personal_custody' and currency = 'NPR') = 1
  and not exists (
    select 1 from public.money_transfers t
     where t.from_account_id = vat.id
       and t.to_account_id = nonvat.id
       and t.from_amount = 20340
  );

-- Summit Legal's VAT (a lawyer's VAT invoice with Avernek's VAT number) is
-- claimable: mark it so its 2,340 comes off the VAT owed (4,550 − 2,340 = 2,210).
update public.company_bills
   set claim_vat = true, updated_at = now()
 where total_amount = 20340 and vat_amount = 2340 and bill_date = '2026-09-22' and claim_vat = false;
