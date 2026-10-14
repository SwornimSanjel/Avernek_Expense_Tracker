-- =============================================================================
-- Upload first, attach on save.
--
-- Files are now uploaded one at a time to /api/files the moment they are
-- picked, instead of riding inside the form post. (Cloudflare's firewall
-- occasionally blocked form posts that carried photo bytes; plain file uploads
-- to the API pass.) A freshly uploaded file is "staged": it has its kind but
-- no owner yet. Saving the form claims it by setting the owner column.
-- Staged files nobody claimed (the form was cancelled) are cleaned up after a
-- day by the upload route.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.attachments drop constraint if exists attachments_one_owner;

alter table public.attachments
  add constraint attachments_one_owner check (
    -- staged: uploaded, not yet attached to anything
    (expense_id is null and agreement_id is null and payment_id is null and company_bill_id is null)
    or (kind = 'expense_bill'     and expense_id is not null
       and agreement_id is null and payment_id is null and company_bill_id is null)
    or (kind = 'client_agreement' and agreement_id is not null
       and expense_id is null and payment_id is null and company_bill_id is null)
    or (kind = 'vat_bill'         and payment_id is not null
       and expense_id is null and agreement_id is null and company_bill_id is null)
    or (kind = 'company_bill'     and company_bill_id is not null
       and expense_id is null and agreement_id is null and payment_id is null)
  );

create index if not exists attachments_staged
  on public.attachments (created_at)
  where expense_id is null and agreement_id is null and payment_id is null and company_bill_id is null;
