-- Bills in Avernek's name: whether the VAT account is to pay the bill back to
-- whoever paid it. Most bills (cafes, shops) are kept only for the books and
-- their VAT, so the default is no; a bill to be paid back is switched on in
-- Edit. A bill already (partly) reimbursed still shows what was paid back.
-- Safe to run more than once.
alter table public.company_bills
  add column if not exists reimburse boolean not null default false;
