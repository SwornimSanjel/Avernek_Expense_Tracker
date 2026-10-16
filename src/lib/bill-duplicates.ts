import { query } from "@/lib/db";

/**
 * Expenses a receipt upload created for spending that had already been typed
 * in by hand — the same money counted twice.
 *
 * A "copy" is an expense made by the upload: it carries the receipt (a file,
 * and "· receipt <no>" in its note) or it was created together with a bill on
 * the Bills page. Its "original" is an older expense from the same vendor (or
 * the same type when no vendor was picked, or naming the vendor in its note),
 * within a week, for about the same money — a USD receipt also matches the NPR
 * the bank charged, if that is how it was typed.
 */
export type ReceiptCopy = {
  copyId: string;
  keepId: string;
  label: string;
  copyDate: string;
  keepDate: string;
  copyText: string;
  keepText: string;
  keepNote: string | null;
};

export async function findReceiptCopies(): Promise<ReceiptCopy[]> {
  const rows = await query<{
    copy_id: string;
    keep_id: string;
    label: string;
    copy_date: string;
    keep_date: string;
    copy_currency: string;
    copy_amount: string;
    copy_npr: string | null;
    keep_currency: string;
    keep_amount: string;
    keep_npr: string | null;
    keep_note: string | null;
  }>(
    `select distinct on (copy.id)
            copy.id as copy_id, keep.id as keep_id,
            coalesce(v.name, c.name, 'Expense') as label,
            copy.expense_date as copy_date, keep.expense_date as keep_date,
            copy.currency as copy_currency, copy.amount as copy_amount, copy.amount_npr as copy_npr,
            keep.currency as keep_currency, keep.amount as keep_amount, keep.amount_npr as keep_npr,
            keep.note as keep_note
       from public.expenses copy
       left join public.vendors v on v.id = copy.vendor_id
       left join public.categories c on c.id = copy.category_id
       join public.expenses keep
         on keep.id <> copy.id
        and keep.created_at < copy.created_at
        and abs(keep.expense_date - copy.expense_date) <= 7
        and (
          keep.vendor_id = copy.vendor_id
          or (keep.vendor_id is null and keep.category_id is not distinct from copy.category_id)
          or (v.name is not null and keep.note ilike '%' || split_part(v.name, ' ', 1) || '%')
          or (v.name like '%(%' and keep.note ilike '%' || replace(split_part(v.name, '(', 2), ')', '') || '%')
        )
        and (
          (keep.currency = copy.currency and abs(keep.amount - copy.amount) <= greatest(1, copy.amount * 0.02))
          or abs(coalesce(keep.amount_npr, keep.amount) - coalesce(copy.amount_npr, copy.amount))
             <= greatest(5, coalesce(copy.amount_npr, copy.amount) * 0.03)
        )
        -- the original was typed by hand: no receipt of its own, not made by the upload
        and not exists (select 1 from public.attachments a where a.expense_id = keep.id)
        and coalesce(keep.note, '') not like '% · receipt %'
        and not exists (
          select 1 from public.company_bills kb
           where kb.expense_id = keep.id and abs(extract(epoch from kb.created_at - keep.created_at)) < 120
        )
      where (
              -- created by the upload: the expense and its receipt appeared together
              exists (
                select 1 from public.attachments a
                 where a.expense_id = copy.id and abs(extract(epoch from copy.created_at - a.created_at)) < 3600
              )
              and copy.note like '% · receipt %'
            )
         or exists (
              select 1 from public.company_bills b
               where b.expense_id = copy.id and abs(extract(epoch from b.created_at - copy.created_at)) < 120
            )
      order by copy.id, abs(keep.expense_date - copy.expense_date), keep.created_at desc`
  );
  const money = (currency: string, amount: string, npr: string | null) =>
    currency === "NPR"
      ? `NPR ${Number(amount).toLocaleString("en-NP")}`
      : `${currency} ${Number(amount).toLocaleString("en-NP")}${npr ? ` (NPR ${Number(npr).toLocaleString("en-NP")})` : ""}`;
  return rows.map((row) => ({
    copyId: row.copy_id,
    keepId: row.keep_id,
    label: row.label,
    copyDate: row.copy_date,
    keepDate: row.keep_date,
    copyText: money(row.copy_currency, row.copy_amount, row.copy_npr),
    keepText: money(row.keep_currency, row.keep_amount, row.keep_npr),
    keepNote: row.keep_note,
  }));
}
