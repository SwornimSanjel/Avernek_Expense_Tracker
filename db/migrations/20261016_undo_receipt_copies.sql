-- =============================================================================
-- Undo the expenses the receipt upload created for spending that had already
-- been typed into Expenses by hand (every subscription was recorded when the
-- card was loaded; only the receipts were uploaded later). Those copies took
-- the same money off the Non-VAT account a second time.
--
-- For each copy (an expense whose note ends "· receipt <no>" and whose file
-- was uploaded together with it):
--   * if the hand-typed expense for it is found (same vendor, or the vendor
--     named in its note, or no vendor and the same type; within 25 days; about
--     the same NPR), the receipt moves onto that expense and the copy is
--     deleted;
--   * otherwise the copy is still removed, and its receipt is kept on the
--     Bills page as a bill "counted elsewhere" (already in Expenses), so no
--     document is lost. "Link to its expense" on that bill can add it again if
--     it turns out it was never typed.
--
-- Every change shows on the Activity log as "System". Safe to run more than
-- once: a second run finds no copies.
-- =============================================================================

do $$
declare
  copy        record;
  keep_id     uuid;
  receipt_no  text;
  vendor_re   text;
  other_re    text;
  bill_id     uuid;
begin
  for copy in
    select e.id, e.note, e.expense_date, e.created_at, e.vendor_id, e.category_id, e.currency, e.amount,
           coalesce(e.amount_npr, e.amount) as npr, v.name as vendor_name
      from public.expenses e
      left join public.vendors v on v.id = e.vendor_id
     where coalesce(e.note, '') like '% · receipt %'
       and exists (
             select 1 from public.attachments a
              where a.expense_id = e.id
                and abs(extract(epoch from e.created_at - a.created_at)) < 3600
           )
       and not exists (select 1 from public.company_bills b where b.expense_id = e.id)
  loop
    vendor_re := case
      when copy.vendor_name ilike 'anthropic%' then '(claude|anthropic)'
      when copy.vendor_name ilike 'openai%'    then '(chatgpt|gpt|openai)'
      else null end;
    other_re := case
      when copy.vendor_name ilike 'anthropic%' then '(chatgpt|gpt|openai)'
      when copy.vendor_name ilike 'openai%'    then '(claude|anthropic)'
      else null end;

    keep_id := null;
    select k.id into keep_id
      from public.expenses k
     where k.id <> copy.id
       and k.created_at < copy.created_at
       and abs(k.expense_date - copy.expense_date) <= 25
       and abs(coalesce(k.amount_npr, k.amount) - copy.npr) <= greatest(10, copy.npr * 0.08)
       -- typed by hand: no receipt of its own, not made by an upload, not a bill's
       and not exists (select 1 from public.attachments a where a.expense_id = k.id)
       and coalesce(k.note, '') not like '% · receipt %'
       and not exists (select 1 from public.company_bills b where b.expense_id = k.id)
       -- never another subscription (a ChatGPT entry for a Claude receipt)
       and (other_re is null or coalesce(k.note, '') !~* other_re)
       and (
             (vendor_re is not null and coalesce(k.note, '') ~* vendor_re)
             or k.vendor_id = copy.vendor_id
             or (k.vendor_id is null and k.category_id is not distinct from copy.category_id)
           )
     order by
       case
         when vendor_re is not null and coalesce(k.note, '') ~* vendor_re then 0
         when k.vendor_id = copy.vendor_id then 1
         else 2
       end,
       abs(coalesce(k.amount_npr, k.amount) - copy.npr),
       abs(k.expense_date - copy.expense_date)
     limit 1;

    receipt_no := substring(copy.note from 'receipt ([0-9A-Za-z-]+)');

    if keep_id is not null then
      update public.attachments set expense_id = keep_id where expense_id = copy.id;
      update public.expenses
         set note = case
               when receipt_no is null or coalesce(note, '') like '%' || receipt_no || '%' then note
               else coalesce(nullif(note, '') || ' · ', '') || 'receipt ' || receipt_no
             end
       where id = keep_id;
      delete from public.expenses where id = copy.id;
      raise notice 'Merged "%" into the typed expense %', copy.note, keep_id;
    else
      insert into public.company_bills
        (description, vendor_name, bill_number, bill_date, total_amount, vat_amount, claim_vat,
         category_id, counted_elsewhere, note)
      values (
        split_part(copy.note, ' · receipt ', 1),
        copy.vendor_name,
        receipt_no,
        copy.expense_date,
        copy.npr,
        0,
        false,
        copy.category_id,
        true,
        'Receipt uploaded after the spending was already in Expenses (' ||
          case when copy.currency = 'NPR' then 'NPR ' else copy.currency || ' ' end || copy.amount || ').'
      )
      returning id into bill_id;
      update public.attachments
         set kind = 'company_bill', expense_id = null, company_bill_id = bill_id
       where expense_id = copy.id;
      delete from public.expenses where id = copy.id;
      raise notice 'Removed copy "%"; its receipt is kept as bill %', copy.note, bill_id;
    end if;
  end loop;
end $$;
