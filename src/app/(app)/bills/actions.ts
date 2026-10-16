"use server";

import { revalidatePath } from "next/cache";
import { exec, one, query, transaction } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import { addExpense } from "../expenses/actions";
import { scanStagedFiles, type ReceiptScan } from "@/lib/receipts.server";
import type { Currency } from "@/lib/types";

/**
 * Bills and receipts in, counted once.
 *
 *   scanReceipts   read uploaded files (PDF text free; photos by AI on request)
 *   saveReceipts   save the reviewed list:
 *                    NPR bill  → a bill on the Bills page (VAT tracked) and the
 *                                expense it is counted as
 *                    USD receipt (Claude, ChatGPT…) → an expense with the
 *                                receipt attached; foreign tax cannot be
 *                                claimed, so it is simply part of the cost
 *   countBillAsExpense / unlinkBillExpense   for bills saved before this
 *
 * Expenses are created through the Expenses page's own save, so currency
 * conversion, account checks and file handling are exactly the same.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGED = "expense_id is null and agreement_id is null and payment_id is null and company_bill_id is null";

async function owner() {
  const session = await requireSession();
  assertAppOwner(session);
  return session;
}

function revalidateBills() {
  for (const path of ["/bills", "/expenses", "/vat", "/funds", "/statement", "/"]) revalidatePath(path);
}

/** Who paid for something: a company account, a partner's own money, or nobody new. */
export type PaidWith =
  | { by: "account"; accountId: string }
  | { by: "person"; userId: string }
  /** Already typed into Expenses: attach to that expense, count nothing again. */
  | { by: "link"; expenseId: string }
  /** Do not create an expense: already recorded, or not a company expense. */
  | { by: "skip" };

export async function scanReceipts(
  fileIds: string[],
  withAi: boolean
): Promise<{ error: string | null; scans: ReceiptScan[] }> {
  try {
    const session = await owner();
    const ids = [...new Set(fileIds)].filter((id) => UUID_RE.test(id)).slice(0, 20);
    if (!ids.length) return { error: "Add at least one bill or receipt.", scans: [] };
    return { error: null, scans: await scanStagedFiles(ids, withAi, session.sub) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read the files.", scans: [] };
  }
}

export type ReceiptSave = {
  fileId: string;
  categoryId: string | null;
  vendorName: string;
  description: string;
  date: string;
  currency: Currency;
  /** What was paid, tax included. */
  total: number;
  /** NPR bills: the VAT printed on the bill. */
  vat: number;
  claimVat: boolean;
  number: string | null;
  paid: PaidWith;
  /** USD paid from an NPR account: the NPR the bank statement shows. */
  actualNpr: number | null;
};

async function vendorIdFor(name: string): Promise<string | null> {
  if (!name.trim()) return null;
  const row = await one<{ id: string }>(
    `select id from public.vendors where lower(name) = lower($1)
        or lower(name) like lower($1) || ' (%'
      order by length(name) limit 1`,
    [name.trim()]
  );
  return row?.id ?? null;
}

/** Create the expense through the Expenses page's own save. */
async function createExpense(input: {
  amount: number;
  currency: Currency;
  date: string;
  categoryId: string | null;
  vendorName: string;
  note: string;
  paid: Extract<PaidWith, { by: "account" } | { by: "person" }>;
  actualNpr: number | null;
  fileIds: string[];
}): Promise<string> {
  const form = new FormData();
  form.set("amount", String(input.amount));
  form.set("currency", input.currency);
  form.set("expense_date", input.date);
  if (input.categoryId) form.set("category_id", input.categoryId);
  const vendorId = await vendorIdFor(input.vendorName);
  if (vendorId) form.set("vendor_id", vendorId);
  form.set("note", vendorId || !input.vendorName ? input.note : `${input.vendorName} · ${input.note}`);
  if (input.paid.by === "account") {
    form.set("funding_source", "company_funds");
    form.set("money_account_id", input.paid.accountId);
  } else {
    form.set("funding_source", "personal");
    form.set("paid_by_user_id", input.paid.userId);
  }
  if (input.actualNpr != null && input.currency === "USD") form.set("actual_npr_charged", String(input.actualNpr));
  for (const id of input.fileIds) form.append("bills", id);
  const result = await addExpense(form);
  if (result.error || !result.id) throw new Error(result.error ?? "Could not save the expense.");
  return result.id;
}

function checkSave(item: ReceiptSave): string | null {
  if (!UUID_RE.test(item.fileId)) return "The file was not found.";
  if (!item.description.trim() && !item.vendorName.trim()) return "Say what the bill is for.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return "Enter the bill date.";
  if (!Number.isFinite(item.total) || item.total <= 0) return "Enter the amount paid.";
  if (!(["NPR", "USD"] as string[]).includes(item.currency)) return "Choose NPR or USD.";
  if (item.currency === "NPR" && (!Number.isFinite(item.vat) || item.vat < 0 || item.vat > item.total)) {
    return "VAT must be between zero and the total.";
  }
  if (item.currency === "USD" && item.paid.by === "skip") return "A foreign receipt is saved as an expense: choose who paid.";
  if (item.paid.by === "link" && !UUID_RE.test(item.paid.expenseId)) return "Choose the expense it belongs to.";
  if (item.paid.by === "account" && !UUID_RE.test(item.paid.accountId)) return "Choose the account that paid.";
  if (item.paid.by === "person" && !UUID_RE.test(item.paid.userId)) return "Choose who paid.";
  return null;
}

/** Save one reviewed bill or receipt. Returns what was created. */
async function saveOne(item: ReceiptSave, userId: string): Promise<string> {
  const invalid = checkSave(item);
  if (invalid) throw new Error(invalid);
  const description = item.description.trim() || item.vendorName.trim();
  const noteNumber = item.number ? ` · receipt ${item.number}` : "";

  // Already typed into Expenses: the receipt joins that expense. No new money.
  let linkedId: string | null = null;
  if (item.paid.by === "link") {
    linkedId = item.paid.expenseId;
    const taken = await one<{ id: string }>(`select id from public.company_bills where expense_id = $1`, [linkedId]);
    if (taken) throw new Error("That expense already has a bill counted against it.");
    const exists = await one<{ note: string | null }>(`select note from public.expenses where id = $1`, [linkedId]);
    if (!exists) throw new Error("That expense no longer exists.");
    // Keep the receipt number on it so the same receipt is recognised next time.
    if (item.number && !(exists.note ?? "").includes(item.number)) {
      await exec(`update public.expenses set note = $1 where id = $2`, [
        `${exists.note ? `${exists.note} · ` : ""}receipt ${item.number}`,
        linkedId,
      ]);
    }
  }

  if (item.currency === "USD") {
    if (linkedId) {
      const attached = await exec(
        `update public.attachments set kind = 'expense_bill', expense_id = $1 where id = $2 and ${STAGED}`,
        [linkedId, item.fileId]
      );
      if (!attached) throw new Error("The file expired or was already saved. Upload it again.");
      return "attached";
    }
    // The file was uploaded as a bill; an expense owns it now.
    const moved = await exec(
      `update public.attachments set kind = 'expense_bill' where id = $1 and ${STAGED}`,
      [item.fileId]
    );
    if (!moved) throw new Error("The file expired or was already saved. Upload it again.");
    await createExpense({
      amount: item.total,
      currency: "USD",
      date: item.date,
      categoryId: item.categoryId,
      vendorName: item.vendorName,
      note: `${description}${noteNumber}`,
      paid: item.paid as Extract<PaidWith, { by: "account" } | { by: "person" }>,
      actualNpr: item.actualNpr,
      fileIds: [item.fileId],
    });
    return "expense";
  }

  // An NPR bill: kept on the Bills page (VAT), counted as an expense once.
  const counts = item.categoryId
    ? (await one<{ counts_as_expense: boolean }>(`select counts_as_expense from public.categories where id = $1`, [item.categoryId]))
        ?.counts_as_expense ?? true
    : true;
  let expenseId: string | null = linkedId;
  if (!linkedId && (item.paid.by === "account" || item.paid.by === "person") && counts) {
    expenseId = await createExpense({
      amount: item.total,
      currency: "NPR",
      date: item.date,
      categoryId: item.categoryId,
      vendorName: item.vendorName,
      note: `${description}${noteNumber}`,
      paid: item.paid,
      actualNpr: null,
      fileIds: [],
    });
  }
  try {
    const bill = await one<{ id: string }>(
      `insert into public.company_bills
         (description, vendor_name, bill_number, bill_date, total_amount, vat_amount, claim_vat,
          category_id, expense_id, paid_by, created_by, counted_elsewhere)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id`,
      [
        description,
        item.vendorName.trim() || null,
        item.number,
        item.date,
        Math.round(item.total * 100) / 100,
        Math.round(item.vat * 100) / 100,
        item.vat > 0 && item.claimVat,
        item.categoryId,
        expenseId,
        item.paid.by === "account" ? "Company account" : null,
        userId,
        // "Already in Expenses another way": counted, and no money moves.
        item.paid.by === "skip" && counts,
      ]
    );
    const claimed = await exec(
      `update public.attachments set kind = 'company_bill', company_bill_id = $1 where id = $2 and ${STAGED}`,
      [bill!.id, item.fileId]
    );
    if (!claimed) throw new Error("The file expired or was already saved. Upload it again.");
  } catch (error) {
    // Never leave an expense behind for a bill that did not save (a linked,
    // already existing expense is of course kept).
    if (expenseId && !linkedId) await exec(`delete from public.expenses where id = $1`, [expenseId]);
    throw error;
  }
  return expenseId ? "bill+expense" : "bill";
}

export async function saveReceipts(
  items: ReceiptSave[]
): Promise<{ error: string | null; saved: number; failed: { fileId: string; error: string }[] }> {
  let session;
  try {
    session = await owner();
  } catch {
    return { error: "Only an administrator can add bills.", saved: 0, failed: [] };
  }
  if (!Array.isArray(items) || items.length === 0) return { error: "Nothing to save.", saved: 0, failed: [] };
  if (items.length > 20) return { error: "Save at most 20 bills at a time.", saved: 0, failed: [] };

  let saved = 0;
  const failed: { fileId: string; error: string }[] = [];
  for (const item of items) {
    try {
      await saveOne(item, session.sub);
      saved += 1;
    } catch (error) {
      failed.push({ fileId: item.fileId, error: error instanceof Error ? error.message : "Could not save." });
    }
  }
  revalidateBills();
  return { error: failed.length && !saved ? failed[0].error : null, saved, failed };
}

// -----------------------------------------------------------------------------
// Bills saved before: count them as an expense, or link the one already there
// -----------------------------------------------------------------------------

export async function countBillAsExpense(
  billId: string,
  choice: { link: string } | { paid: PaidWith } | { elsewhere: true }
): Promise<{ error: string | null }> {
  try {
    await owner();
    if (!UUID_RE.test(billId)) return { error: "That bill was not found." };
    const bill = await one<{
      description: string;
      vendor_name: string | null;
      bill_number: string | null;
      bill_date: string;
      total_amount: string;
      category_id: string | null;
      expense_id: string | null;
    }>(
      `select description, vendor_name, bill_number, bill_date, total_amount, category_id, expense_id
         from public.company_bills where id = $1`,
      [billId]
    );
    if (!bill) return { error: "That bill was not found." };
    if (bill.expense_id) return { error: "This bill is already counted as an expense." };

    // Covered by an expense that cannot be linked one-to-one (e.g. one combined
    // "food this week" entry): mark it counted, change no money.
    if ("elsewhere" in choice) {
      await exec(`update public.company_bills set counted_elsewhere = true, updated_at = now() where id = $1`, [billId]);
      revalidateBills();
      return { error: null };
    }

    let expenseId: string;
    if ("link" in choice) {
      if (!UUID_RE.test(choice.link)) return { error: "Choose the expense to link." };
      const taken = await one<{ id: string }>(`select id from public.company_bills where expense_id = $1`, [choice.link]);
      if (taken) return { error: "That expense is already linked to another bill." };
      const exists = await one<{ id: string }>(`select id from public.expenses where id = $1`, [choice.link]);
      if (!exists) return { error: "That expense no longer exists." };
      expenseId = choice.link;
    } else {
      if (choice.paid.by !== "account" && choice.paid.by !== "person") return { error: "Choose who paid." };
      expenseId = await createExpense({
        amount: Number(bill.total_amount),
        currency: "NPR",
        date: bill.bill_date,
        categoryId: bill.category_id,
        vendorName: bill.vendor_name ?? "",
        note: `${bill.description}${bill.bill_number ? ` · bill ${bill.bill_number}` : ""}`,
        paid: choice.paid,
        actualNpr: null,
        fileIds: [],
      });
    }
    await exec(`update public.company_bills set expense_id = $1, updated_at = now() where id = $2`, [expenseId, billId]);
    revalidateBills();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not count this bill." };
  }
}

/** Keep the expense, drop the link (e.g. it was linked to the wrong one). */
export async function unlinkBillExpense(billId: string): Promise<{ error: string | null }> {
  try {
    await owner();
    await exec(
      `update public.company_bills set expense_id = null, counted_elsewhere = false, updated_at = now() where id = $1`,
      [billId]
    );
    revalidateBills();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not unlink." };
  }
}

/** Change a bill's type from the list. */
export async function setBillCategory(billId: string, categoryId: string | null): Promise<{ error: string | null }> {
  try {
    await owner();
    if (!UUID_RE.test(billId) || (categoryId && !UUID_RE.test(categoryId))) return { error: "Not found." };
    await exec(`update public.company_bills set category_id = $1, updated_at = now() where id = $2`, [categoryId, billId]);
    const linked = await one<{ expense_id: string | null }>(`select expense_id from public.company_bills where id = $1`, [billId]);
    if (linked?.expense_id) {
      await exec(`update public.expenses set category_id = $1 where id = $2`, [categoryId, linked.expense_id]);
    }
    revalidateBills();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not change the type." };
  }
}

/** Expenses that look like this bill (same amount, within a week), not linked yet. */
export async function matchingExpenses(billId: string) {
  await owner();
  return query<{ id: string; expense_date: string; amount_npr: string | null; note: string | null; vendor: string | null }>(
    `select e.id, e.expense_date, e.amount_npr, e.note, v.name as vendor
       from public.company_bills b
       join public.expenses e
         on abs(coalesce(e.amount_npr, e.amount) - b.total_amount) <= greatest(2, b.total_amount * 0.01)
        and abs(e.expense_date - b.bill_date) <= 10
       left join public.vendors v on v.id = e.vendor_id
      where b.id = $1
        and not exists (select 1 from public.company_bills other where other.expense_id = e.id)
      order by abs(e.expense_date - b.bill_date), e.created_at desc
      limit 5`,
    [billId]
  );
}

// -----------------------------------------------------------------------------
// Old bills: never count money twice
// -----------------------------------------------------------------------------

/**
 * A receipt upload created a second expense for spending that was already
 * typed in by hand. Keep the typed expense (its money was already right), move
 * the receipt and any bill link onto it, and delete the copy. Balances go back
 * to what they were before the upload.
 */
export async function mergeReceiptCopy(copyId: string, keepId: string): Promise<{ error: string | null }> {
  try {
    await owner();
    if (!UUID_RE.test(copyId) || !UUID_RE.test(keepId) || copyId === keepId) return { error: "Not found." };
    const copy = await one<{ note: string | null }>(`select note from public.expenses where id = $1`, [copyId]);
    const keep = await one<{ note: string | null }>(`select note from public.expenses where id = $1`, [keepId]);
    if (!copy || !keep) return { error: "One of these expenses no longer exists." };
    const receipt = copy.note?.match(/receipt ([\w-]+)/)?.[1] ?? null;
    await transaction(async (client) => {
      // Files first: deleting an expense deletes its files.
      await client.query(`update public.attachments set expense_id = $1 where expense_id = $2`, [keepId, copyId]);
      const keepLinked = await client.query(`select 1 from public.company_bills where expense_id = $1`, [keepId]);
      await client.query(`update public.company_bills set expense_id = $1 where expense_id = $2`, [
        keepLinked.rowCount ? null : keepId,
        copyId,
      ]);
      if (receipt && !(keep.note ?? "").includes(receipt)) {
        await client.query(`update public.expenses set note = $1 where id = $2`, [
          `${keep.note ? `${keep.note} · ` : ""}receipt ${receipt}`,
          keepId,
        ]);
      }
      await client.query(`delete from public.expenses where id = $1`, [copyId]);
    });
    revalidateBills();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not fix this." };
  }
}

/**
 * "These are old bills, already in Expenses": every bill not counted yet is
 * linked to the one expense that clearly matches it (same amount, within 10
 * days, not taken by another bill), and the rest are marked as counted
 * elsewhere. No expense is created and no balance changes.
 */
export async function settleOldBills(): Promise<{ error: string | null; linked: number; marked: number }> {
  try {
    await owner();
    const bills = await query<{ id: string; total_amount: string; bill_date: string }>(
      `select b.id, b.total_amount, b.bill_date
         from public.company_bills b
         left join public.categories c on c.id = b.category_id
        where b.expense_id is null and not b.counted_elsewhere and coalesce(c.counts_as_expense, true)
        order by b.bill_date`
    );
    let linked = 0;
    let marked = 0;
    const used = new Set<string>();
    for (const bill of bills) {
      const candidates = await query<{ id: string }>(
        `select e.id from public.expenses e
          where e.currency = 'NPR'
            and abs(coalesce(e.amount_npr, e.amount) - $1) <= greatest(2, $1 * 0.01)
            and abs(e.expense_date - $2::date) <= 10
            and not exists (select 1 from public.company_bills other where other.expense_id = e.id)
          order by abs(e.expense_date - $2::date)
          limit 2`,
        [Number(bill.total_amount), bill.bill_date]
      );
      const free = candidates.filter((row) => !used.has(row.id));
      // Link only when exactly one expense fits; two equal ones are ambiguous.
      if (free.length === 1) {
        used.add(free[0].id);
        await exec(`update public.company_bills set expense_id = $1, updated_at = now() where id = $2`, [free[0].id, bill.id]);
        linked += 1;
      } else {
        await exec(`update public.company_bills set counted_elsewhere = true, updated_at = now() where id = $1`, [bill.id]);
        marked += 1;
      }
    }
    revalidateBills();
    return { error: null, linked, marked };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not settle the bills.", linked: 0, marked: 0 };
  }
}
