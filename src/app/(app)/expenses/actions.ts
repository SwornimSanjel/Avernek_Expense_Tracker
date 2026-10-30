"use server";

import { revalidatePath } from "next/cache";
import { exec, insertRows, one, query, transaction, updateRow } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { getUsdSellRateForDate, resolveConversion } from "@/lib/fx";
import type { Currency, ExpenseFundingSource } from "@/lib/types";
import {
  billingMonthDate,
  readShareInputs,
  toExpenseShareRows,
  validateShareTotal,
} from "@/lib/shares";
import { assertCanManageExpenses } from "@/lib/authz";
import { bulkIds, bulkResult, type BulkResult } from "@/lib/bulk";
import {
  assertRoomFor,
  insertAttachments,
  readUploads,
} from "@/lib/attachments.server";

function n(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * "Do you have a bill?" from the expense form. A "yes" needs the bill number
 * and at least one photo (`photos` counts the new uploads plus any already
 * saved). The seller's PAN / VAT number is optional — many bills don't print
 * one — but when given it must be 9 digits. New expenses must answer; an older
 * expense being edited may stay unanswered (null).
 */
function readBill(formData: FormData, photos: number, mustAnswer: boolean) {
  const answer = String(formData.get("has_bill") ?? "");
  if (answer === "no") return { has_bill: false, bill_number: null, seller_pan: null };
  if (answer !== "yes") {
    if (mustAnswer) throw new Error("Answer “Do you have a bill?” — choose No bill or Yes.");
    return { has_bill: null, bill_number: null, seller_pan: null };
  }
  const billNumber = String(formData.get("bill_number") ?? "").trim();
  const pan = String(formData.get("seller_pan") ?? "").replace(/[\s-]/g, "");
  if (!billNumber) throw new Error("Enter the bill number.");
  if (billNumber.length > 60) throw new Error("The bill number is too long.");
  if (pan && !/^\d{9}$/.test(pan)) throw new Error("The PAN / VAT number must be 9 digits, or leave it empty.");
  if (photos < 1) throw new Error("Add a photo of the bill.");
  return { has_bill: true, bill_number: billNumber, seller_pan: pan || null };
}

/**
 * Returns the error instead of throwing it: in production Next.js replaces a
 * thrown server-action message with a generic one, and "this file is not a
 * bill" has to reach the person who picked it.
 */
export async function addExpense(formData: FormData): Promise<{ error: string | null; id?: string }> {
  try {
    const id = await saveNewExpense(formData);
    return { error: null, id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save expense" };
  }
}

async function saveNewExpense(formData: FormData): Promise<string> {
  const session = await requireSession();

  const amount = n(formData.get("amount")) ?? 0;
  const currency = (formData.get("currency") as Currency) ?? "NPR";
  const expense_date =
    (formData.get("expense_date") as string) ||
    new Date().toISOString().slice(0, 10);
  const actualNprCharged = n(formData.get("actual_npr_charged"));
  const manualRate = n(formData.get("manual_rate"));
  const fundingSource = String(
    formData.get("funding_source") ?? "personal"
  ) as ExpenseFundingSource;
  if (!(["personal", "company_funds"] as string[]).includes(fundingSource)) {
    throw new Error("Choose founder/team investment or company operating money.");
  }
  const moneyAccountId =
    fundingSource === "company_funds"
      ? String(formData.get("money_account_id") ?? "")
      : null;
  let moneyAccount: { currency: Currency; is_active: boolean } | null = null;
  if (fundingSource === "company_funds") {
    if (!moneyAccountId) throw new Error("Choose which company-money account paid.");
    moneyAccount = await one<{ currency: Currency; is_active: boolean }>(
      `select currency, is_active from public.money_accounts where id = $1`,
      [moneyAccountId]
    );
    if (!moneyAccount?.is_active) throw new Error("That company-money account is unavailable.");
  }
  const shares = fundingSource === "personal" ? readShareInputs(formData) : [];
  validateShareTotal(shares, amount);
  const bills = await readUploads(formData, "bills");
  // The expense form always posts has_bill ("" until answered), so a person
  // adding an expense must answer. Receipt scans and the assistant don't ask.
  const bill = readBill(formData, bills.length, formData.has("has_bill"));

  // Look up the NRB sell rate for the expense date only when we actually need it
  // (USD, and no exact charge / manual rate supplied).
  let nrbRate = null;
  if (currency === "USD" && actualNprCharged == null && manualRate == null) {
    nrbRate = await getUsdSellRateForDate(expense_date);
  }

  const conv = resolveConversion({
    amount,
    currency,
    actualNprCharged,
    nrbRate,
    manualRate,
  });
  if (
    moneyAccount &&
    moneyAccount.currency !== currency &&
    !(moneyAccount.currency === "NPR" && currency === "USD" && actualNprCharged != null)
  ) {
    throw new Error("For a USD charge paid from an NPR account, enter the exact NPR amount shown on the bank statement.");
  }

  // The expense and its shares must both land or neither: a saved expense with
  // no shares silently breaks the split. Previously this was a delete-on-failure
  // compensation, which left orphans if the delete itself failed.
  const expenseId = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.expenses
         (amount, currency, expense_date, billing_month, category_id, vendor_id,
          paid_by_user_id, funding_source, money_account_id, client, note,
          receipt_url, source, created_by,
          amount_npr, fx_rate_to_npr, fx_rate_date, fx_source, conversion_status,
          actual_npr_charged, has_bill, bill_number, seller_pan)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       returning id`,
      [
        amount,
        currency,
        expense_date,
        billingMonthDate(formData.get("billing_month")),
        (formData.get("category_id") as string) || null,
        (formData.get("vendor_id") as string) || null,
        fundingSource === "personal"
          ? (formData.get("paid_by_user_id") as string) || session.sub
          : null,
        fundingSource,
        moneyAccountId,
        (formData.get("client") as string) || null,
        (formData.get("note") as string) || null,
        (formData.get("receipt_url") as string) || null,
        session.sub,
        conv.amount_npr,
        conv.fx_rate_to_npr,
        conv.fx_rate_date,
        conv.fx_source,
        conv.conversion_status,
        conv.actual_npr_charged,
        bill.has_bill,
        bill.bill_number,
        bill.seller_pan,
      ]
    );

    const expenseId = inserted.rows[0].id;

    if (shares.length > 0) {
      await insertRows(
        "public.expense_shares",
        toExpenseShareRows(expenseId, shares, amount, conv.amount_npr),
        client
      );
    }

    // Bills land in the same transaction: an expense is never saved with half
    // of its attachments, and a rejected bill never leaves an expense behind.
    await insertAttachments(client, { kind: "expense_bill", id: expenseId }, bills, session.sub);
    return expenseId;
  });

  revalidatePath("/expenses");
  revalidatePath("/funds");
  revalidatePath("/income");
  revalidatePath("/clients");
  revalidatePath("/");
  return expenseId;
}

export async function updateExpense(formData: FormData) {
  try {
    const session = await requireSession();
    assertCanManageExpenses(session);

    const id = String(formData.get("expense_id") ?? "");
    if (!id) throw new Error("Expense not found");

    const amount = n(formData.get("amount")) ?? 0;
    const currency = (formData.get("currency") as Currency) || "NPR";
    const expenseDate =
      String(formData.get("expense_date") ?? "") ||
      new Date().toISOString().slice(0, 10);
    const actualNprCharged = n(formData.get("actual_npr_charged"));
    const manualRate = n(formData.get("manual_rate"));
    const fundingSource = String(
      formData.get("funding_source") ?? "personal"
    ) as ExpenseFundingSource;
    if (!(["personal", "company_funds"] as string[]).includes(fundingSource)) {
      throw new Error("Choose founder/team investment or company operating money.");
    }
    const moneyAccountId =
      fundingSource === "company_funds"
        ? String(formData.get("money_account_id") ?? "")
        : null;
    let moneyAccount: { currency: Currency; is_active: boolean } | null = null;
    if (fundingSource === "company_funds") {
      if (!moneyAccountId) throw new Error("Choose which company-money account paid.");
      moneyAccount = await one<{ currency: Currency; is_active: boolean }>(
        `select currency, is_active from public.money_accounts where id = $1`,
        [moneyAccountId]
      );
      if (!moneyAccount?.is_active) throw new Error("That company-money account is unavailable.");
    }
    const shares = fundingSource === "personal" ? readShareInputs(formData) : [];
    validateShareTotal(shares, amount);
    // Any expense — however old — can gain bills here; existing ones stay.
    const bills = await readUploads(formData, "bills");
    await assertRoomFor({ kind: "expense_bill", id }, bills.length);
    const saved = await one<{ count: string }>(
      `select count(*) from public.attachments where kind = 'expense_bill' and expense_id = $1`,
      [id]
    );
    const bill = readBill(formData, bills.length + Number(saved?.count ?? 0), false);

    let nrbRate = null;
    if (currency === "USD" && actualNprCharged == null && manualRate == null) {
      nrbRate = await getUsdSellRateForDate(expenseDate);
    }

    const conv = resolveConversion({
      amount,
      currency,
      actualNprCharged,
      manualRate,
      nrbRate,
    });
    if (
      moneyAccount &&
      moneyAccount.currency !== currency &&
      !(moneyAccount.currency === "NPR" && currency === "USD" && actualNprCharged != null)
    ) {
      throw new Error("For a USD charge paid from an NPR account, enter the exact NPR amount shown on the bank statement.");
    }

    // Replacing the shares is a delete-then-insert, so it must be atomic —
    // otherwise a failure between the two leaves the expense with no split.
    await transaction(async (client) => {
      await updateRow(
        "public.expenses",
        {
          amount,
          currency,
          expense_date: expenseDate,
          billing_month: billingMonthDate(formData.get("billing_month")),
          category_id: String(formData.get("category_id") ?? "") || null,
          vendor_id: String(formData.get("vendor_id") ?? "") || null,
          paid_by_user_id:
            fundingSource === "personal"
              ? String(formData.get("paid_by_user_id") ?? "") || session.sub
              : null,
          funding_source: fundingSource,
          money_account_id: moneyAccountId,
          client: String(formData.get("client") ?? "") || null,
          note: String(formData.get("note") ?? "") || null,
          ...bill,
          ...conv,
        },
        id,
        client
      );

      await client.query(
        `delete from public.expense_shares where expense_id = $1`,
        [id]
      );

      if (shares.length > 0) {
        await insertRows(
          "public.expense_shares",
          toExpenseShareRows(id, shares, amount, conv.amount_npr),
          client
        );
      }

      // New bills are added; existing ones stay until removed explicitly.
      await insertAttachments(client, { kind: "expense_bill", id }, bills, session.sub);
    });

    revalidatePath("/expenses");
    revalidatePath("/funds");
    revalidatePath("/income");
    revalidatePath("/clients");
    revalidatePath("/settlements");
    revalidatePath("/");
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not update expense",
    };
  }
}

export async function toggleReimbursed(id: string, value: boolean) {
  const session = await requireSession();
  assertCanManageExpenses(session);

  await exec(`update public.expenses set is_reimbursed = $1 where id = $2`, [
    value,
    id,
  ]);

  revalidatePath("/expenses");
  revalidatePath("/funds");
  revalidatePath("/settlements");
  revalidatePath("/clients");
}

export async function deleteExpense(id: string) {
  const session = await requireSession();
  assertCanManageExpenses(session);

  await exec(`delete from public.expenses where id = $1`, [id]);

  revalidatePath("/expenses");
  revalidatePath("/funds");
  revalidatePath("/income");
  revalidatePath("/clients");
  revalidatePath("/");
}

/** Several expenses at once: the list's "Select" → "Delete". Same rules as one. */
export async function deleteExpenses(ids: string[]): Promise<BulkResult> {
  const session = await requireSession();
  assertCanManageExpenses(session);
  const list = bulkIds(ids);
  const deleted = list.length
    ? await query<{ id: string }>(`delete from public.expenses where id = any($1::uuid[]) returning id`, [list])
    : [];

  revalidatePath("/expenses");
  revalidatePath("/funds");
  revalidatePath("/income");
  revalidatePath("/clients");
  revalidatePath("/");
  return bulkResult(deleted.length, list.length, { one: "expense", many: "expenses" });
}

/** Retry FX for a pending USD expense (used by the "needs review" flow). */
export async function retryConversion(id: string) {
  const session = await requireSession();
  assertCanManageExpenses(session);

  const exp = await one<{
    id: string;
    amount: string | number;
    currency: string;
    expense_date: string;
  }>(
    `select id, amount, currency, expense_date
       from public.expenses
      where id = $1`,
    [id]
  );

  if (!exp || exp.currency !== "USD") return;

  const expenseDate = String(exp.expense_date).slice(0, 10);
  const nrbRate = await getUsdSellRateForDate(expenseDate);
  const conv = resolveConversion({
    amount: Number(exp.amount),
    currency: "USD",
    nrbRate,
  });

  const shares = await query<{ id: string; amount: string | number }>(
    `select id, amount from public.expense_shares
      where expense_id = $1
      order by id`,
    [id]
  );

  await transaction(async (client) => {
    await updateRow("public.expenses", { ...conv }, id, client);

    // Re-split the NPR total across the shares. The last share absorbs the
    // rounding remainder so the parts still sum exactly to amount_npr.
    let allocated = 0;
    for (let index = 0; index < shares.length; index += 1) {
      const share = shares[index];
      const amountNpr =
        conv.amount_npr == null
          ? null
          : Number(exp.amount) === 0
            ? 0
            : index === shares.length - 1
              ? Math.round((conv.amount_npr - allocated) * 100) / 100
              : Math.round(
                  ((conv.amount_npr * Number(share.amount)) /
                    Number(exp.amount)) *
                    100
                ) / 100;

      if (amountNpr != null) allocated += amountNpr;

      await client.query(
        `update public.expense_shares set amount_npr = $1 where id = $2`,
        [amountNpr, share.id]
      );
    }
  });

  revalidatePath("/expenses");
  revalidatePath("/funds");
  revalidatePath("/income");
  revalidatePath("/clients");
  revalidatePath("/");
}
