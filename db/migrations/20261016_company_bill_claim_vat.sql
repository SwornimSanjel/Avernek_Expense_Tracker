-- Bills in Avernek's name: the VAT printed on a bill (vat_amount) is what was
-- paid; claim_vat says whether that VAT is claimed from IRD as input VAT. VAT
-- on food and drinks usually cannot be claimed, so every bill starts as not
-- claimed, existing ones included: tick "Claim this VAT from IRD" on a bill
-- whose VAT can be claimed (a lawyer's VAT invoice, say).
-- Safe to run more than once.
alter table public.company_bills
  add column if not exists claim_vat boolean not null default false;
