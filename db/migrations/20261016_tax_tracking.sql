-- Taxes paid to IRD by kind and by period, so the app can show which VAT and
-- TDS returns are done and which are due:
--   * tax_type: VAT, TDS (tax held back from salaries, rent, services) or
--     income tax (advance installments and the annual return).
--   * period_key: the Nepali month a VAT or TDS return covers ("2083-06" is
--     Ashwin 2083), or the fiscal year an income tax payment is for ("2083/84").
--   * amount may be 0: a nil return (nothing to pay) must still be filed.
-- Nothing existing changes meaning. Safe to run more than once.
alter table public.tax_payments drop constraint if exists tax_payments_tax_type_check;
alter table public.tax_payments
  add constraint tax_payments_tax_type_check check (tax_type in ('vat', 'tds', 'income_tax'));
alter table public.tax_payments drop constraint if exists tax_payments_amount_check;
alter table public.tax_payments add constraint tax_payments_amount_check check (amount >= 0);
alter table public.tax_payments add column if not exists period_key text;
