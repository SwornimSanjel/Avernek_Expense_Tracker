"use server";

import { revalidatePath } from "next/cache";
import { exec, insertRows, one, query, transaction, updateRow } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { getUsdSellRateForDate, resolveConversion } from "@/lib/fx";
import type { Currency } from "@/lib/types";
import {
  billingMonthDate,
  readShareInputs,
  toExpenseShareRows,
  validateShareTotal,
} from "@/lib/shares";
import { assertCanManageExpenses } from "@/lib/authz";

function n(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export async function addExpense(formData: FormData) {
  const session = await requireSession();

  const amount = n(formData.get("amount")) ?? 0;
  const currency = (formData.get("currency") as Currency) ?? "NPR";
  const expense_date =
    (formData.get("expense_date") as string) ||
    new Date().toISOString().slice(0, 10);
  const actualNprCharged = n(formData.get("actual_npr_charged"));
  const manualRate = n(formData.get("manual_rate"));
  const shares = readShareInputs(formData);
  validateShareTotal(shares, amount);

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

  // The expense and its shares must both land or neither: a saved expense with
  // no shares silently breaks the split. Previously this was a delete-on-failure
  // compensation, which left orphans if the delete itself failed.
  await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.expenses
         (amount, currency, expense_date, billing_month, category_id, vendor_id,
          paid_by_user_id, client, note, receipt_url, source, created_by,
          amount_npr, fx_rate_to_npr, fx_rate_date, fx_source, conversion_status,
          actual_npr_charged)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11,$12,$13,$14,$15,$16,$17)
       returning id`,
      [
        amount,
        currency,
        expense_date,
        billingMonthDate(formData.get("billing_month")),
        (formData.get("category_id") as string) || null,
        (formData.get("vendor_id") as string) || null,
        (formData.get("paid_by_user_id") as string) || session.sub,
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
  });

  revalidatePath("/expenses");
  revalidatePath("/");
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
    const shares = readShareInputs(formData);
    validateShareTotal(shares, amount);

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
            String(formData.get("paid_by_user_id") ?? "") || session.sub,
          client: String(formData.get("client") ?? "") || null,
          note: String(formData.get("note") ?? "") || null,
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
    });

    revalidatePath("/expenses");
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
  revalidatePath("/settlements");
}

export async function deleteExpense(id: string) {
  const session = await requireSession();
  assertCanManageExpenses(session);

  await exec(`delete from public.expenses where id = $1`, [id]);

  revalidatePath("/expenses");
  revalidatePath("/");
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
  revalidatePath("/");
}
