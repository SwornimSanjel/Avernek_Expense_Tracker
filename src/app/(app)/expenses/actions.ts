"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

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
    nrbRate = await getUsdSellRateForDate(supabase, expense_date);
  }

  const conv = resolveConversion({
    amount,
    currency,
    actualNprCharged,
    nrbRate,
    manualRate,
  });

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      amount,
      currency,
      expense_date,
      billing_month: billingMonthDate(formData.get("billing_month")),
      category_id: (formData.get("category_id") as string) || null,
      vendor_id: (formData.get("vendor_id") as string) || null,
      paid_by_user_id: (formData.get("paid_by_user_id") as string) || user.id,
      client: (formData.get("client") as string) || null,
      note: (formData.get("note") as string) || null,
      receipt_url: (formData.get("receipt_url") as string) || null,
      source: "manual",
      created_by: user.id,
      ...conv,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (shares.length > 0 && expense) {
    const rows = toExpenseShareRows(expense.id, shares, amount, conv.amount_npr);
    const { error: shareError } = await supabase.from("expense_shares").insert(rows);
    if (shareError) {
      await supabase.from("expenses").delete().eq("id", expense.id);
      throw new Error(shareError.message);
    }
  }

  revalidatePath("/expenses");
  revalidatePath("/");
}

export async function updateExpense(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    assertCanManageExpenses(user.email);

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
      nrbRate = await getUsdSellRateForDate(supabase, expenseDate);
    }
    const conv = resolveConversion({
      amount,
      currency,
      actualNprCharged,
      manualRate,
      nrbRate,
    });

    const { error } = await supabase
      .from("expenses")
      .update({
        amount,
        currency,
        expense_date: expenseDate,
        billing_month: billingMonthDate(formData.get("billing_month")),
        category_id: String(formData.get("category_id") ?? "") || null,
        vendor_id: String(formData.get("vendor_id") ?? "") || null,
        paid_by_user_id: String(formData.get("paid_by_user_id") ?? "") || user.id,
        client: String(formData.get("client") ?? "") || null,
        note: String(formData.get("note") ?? "") || null,
        ...conv,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    const { error: clearError } = await supabase
      .from("expense_shares")
      .delete()
      .eq("expense_id", id);
    if (clearError) throw new Error(clearError.message);
    if (shares.length > 0) {
      const rows = toExpenseShareRows(id, shares, amount, conv.amount_npr);
      const { error: shareError } = await supabase.from("expense_shares").insert(rows);
      if (shareError) throw new Error(shareError.message);
    }

    revalidatePath("/expenses");
    revalidatePath("/settlements");
    revalidatePath("/");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update expense" };
  }
}

export async function toggleReimbursed(id: string, value: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  assertCanManageExpenses(user.email);

  const { error } = await supabase
    .from("expenses")
    .update({ is_reimbursed: value })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/expenses");
  revalidatePath("/settlements");
}

export async function deleteExpense(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  assertCanManageExpenses(user.email);

  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/expenses");
  revalidatePath("/");
}

/** Retry FX for a pending USD expense (used by the "needs review" flow). */
export async function retryConversion(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  assertCanManageExpenses(user.email);

  const { data: exp } = await supabase
    .from("expenses")
    .select("id, amount, currency, expense_date")
    .eq("id", id)
    .single();
  if (!exp || exp.currency !== "USD") return;

  const nrbRate = await getUsdSellRateForDate(supabase, exp.expense_date);
  const conv = resolveConversion({
    amount: Number(exp.amount),
    currency: "USD",
    nrbRate,
  });
  await supabase.from("expenses").update(conv).eq("id", id);
  const { data: shares } = await supabase
    .from("expense_shares")
    .select("id, amount")
    .eq("expense_id", id)
    .order("id");
  if (shares?.length) {
    let allocated = 0;
    for (let index = 0; index < shares.length; index++) {
      const share = shares[index];
      const amountNpr =
        conv.amount_npr == null
          ? null
          : Number(exp.amount) === 0
            ? 0
          : index === shares.length - 1
            ? Math.round((conv.amount_npr - allocated) * 100) / 100
            : Math.round(((conv.amount_npr * Number(share.amount)) / Number(exp.amount)) * 100) /
              100;
      if (amountNpr != null) allocated += amountNpr;
      await supabase
        .from("expense_shares")
        .update({ amount_npr: amountNpr })
        .eq("id", share.id);
    }
  }
  revalidatePath("/expenses");
  revalidatePath("/");
}
