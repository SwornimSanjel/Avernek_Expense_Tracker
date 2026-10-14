-- =============================================================================
-- Files attached to records: expense bills, signed client agreement pages,
-- VAT bills issued for a client payment, and company bills (VAT & bills page).
--
-- The file itself is stored in Postgres (bytea) so it lives in the same
-- database, the same backups and the same restore drill as the record it
-- proves — there is no separate file store to lose or forget to back up.
--
-- Exactly one owner per file, enforced below. Deleting the owner deletes its
-- files. Only PDF and image files are accepted; the app checks the file's real
-- bytes, not just the name the browser sent.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.attachments (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null
                    check (kind in ('expense_bill','client_agreement','vat_bill','company_bill')),
  expense_id      uuid references public.expenses (id) on delete cascade,
  agreement_id    uuid references public.income_agreements (id) on delete cascade,
  payment_id      uuid references public.income_payments (id) on delete cascade,
  company_bill_id uuid references public.company_bills (id) on delete cascade,
  file_name       text not null,
  content_type    text not null
                    check (content_type in ('application/pdf','image/jpeg','image/png',
                                            'image/webp','image/heic','image/heif')),
  size_bytes      integer not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256          text not null,
  data            bytea not null,
  uploaded_by     uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint attachments_one_owner check (
    (kind = 'expense_bill'     and expense_id is not null
       and agreement_id is null and payment_id is null and company_bill_id is null)
    or (kind = 'client_agreement' and agreement_id is not null
       and expense_id is null and payment_id is null and company_bill_id is null)
    or (kind = 'vat_bill'      and payment_id is not null
       and expense_id is null and agreement_id is null and company_bill_id is null)
    or (kind = 'company_bill'  and company_bill_id is not null
       and expense_id is null and agreement_id is null and payment_id is null)
  )
);

-- PDFs and photos are already compressed; skip TOAST's pointless second pass.
alter table public.attachments alter column data set storage external;

create index if not exists attachments_by_expense
  on public.attachments (expense_id, created_at) where expense_id is not null;
create index if not exists attachments_by_agreement
  on public.attachments (agreement_id, created_at) where agreement_id is not null;
create index if not exists attachments_by_payment
  on public.attachments (payment_id, created_at) where payment_id is not null;
create index if not exists attachments_by_company_bill
  on public.attachments (company_bill_id, created_at) where company_bill_id is not null;

-- The same file attached twice to one record is a mistake, not two pages.
create unique index if not exists attachments_unique_expense_file
  on public.attachments (expense_id, sha256) where expense_id is not null;
create unique index if not exists attachments_unique_agreement_file
  on public.attachments (agreement_id, sha256) where agreement_id is not null;
create unique index if not exists attachments_unique_payment_file
  on public.attachments (payment_id, sha256) where payment_id is not null;
create unique index if not exists attachments_unique_company_bill_file
  on public.attachments (company_bill_id, sha256) where company_bill_id is not null;
