"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUsdSellRateForDate, resolveConversion } from "@/lib/fx";
import type { Currency, Cycle } from "@/lib/types";
import { addMonths, addYears, format, parseISO } from "date-fns";
import {
  billingMonthDate,
  readShareInputs,
  toExpenseShareRows,
  validateShareTotal,
} from "@/lib/shares";
import type { ShareInput } from "@/lib/shares";

function n(v: FormDataEntryValue | null): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function addRecurring(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const amount = n(formData.get("amount"));
  const shares = readShareInputs(formData);
  validateShareTotal(shares, amount);
  const { data: recurring, error } = await supabase
    .from("recurring")
    .insert({
      name: (formData.get("name") as string) || "Subscription",
      amount,
      currency: (formData.get("currency") as Currency) || "NPR",
      cycle: (formData.get("cycle") as Cycle) || "monthly",
      next_renewal_date:
        (formData.get("next_renewal_date") as string) ||
        new Date().toISOString().slice(0, 10),
      category_id: (formData.get("category_id") as string) || null,
      vendor_id: (formData.get("vendor_id") as string) || null,
      paid_by_user_id: (formData.get("paid_by_user_id") as string) || user.id,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (shares.length > 0 && recurring) {
    const { error: shareError } = await supabase.from("recurring_shares").insert(
      shares.map((share) => ({
        recurring_id: recurring.id,
        user_id: share.userId,
        amount: share.amount,
      }))
    );
    if (shareError) {
      revalidatePath("/subscriptions");
      revalidatePath("/");
      return {
        error:
          shareError.code === "PGRST205"
            ? "Subscription saved, but person splits need the Supabase monthly-shares migration."
            : `Subscription saved without its person split: ${shareError.message}`,
      };
    }
  }
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { error: null };
}

export async function toggleActive(id: string, value: boolean) {
  const supabase = await createClient();
  await supabase.from("recurring").update({ is_active: value }).eq("id", id);
  revalidatePath("/subscriptions");
  revalidatePath("/");
}

export async function updateRecurring(formData: FormData) {
  try {
    const supabase = await createClient();
    const id = String(formData.get("recurring_id") ?? "");
    const amount = n(formData.get("amount"));
    const shares = readShareInputs(formData);
    validateShareTotal(shares, amount);

    const { error } = await supabase
      .from("recurring")
      .update({
        name: String(formData.get("name") ?? "").trim() || "Subscription",
        amount,
        currency: (formData.get("currency") as Currency) || "NPR",
        cycle: (formData.get("cycle") as Cycle) || "monthly",
        next_renewal_date:
          String(formData.get("next_renewal_date") ?? "") ||
          new Date().toISOString().slice(0, 10),
        category_id: String(formData.get("category_id") ?? "") || null,
        vendor_id: String(formData.get("vendor_id") ?? "") || null,
        paid_by_user_id: String(formData.get("paid_by_user_id") ?? "") || null,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    const { error: clearError } = await supabase
      .from("recurring_shares")
      .delete()
      .eq("recurring_id", id);
    if (clearError) throw new Error(clearError.message);
    if (shares.length > 0) {
      const { error: shareError } = await supabase.from("recurring_shares").insert(
        shares.map((share) => ({
          recurring_id: id,
          user_id: share.userId,
          amount: share.amount,
        }))
      );
      if (shareError) throw new Error(shareError.message);
    }

    revalidatePath("/subscriptions");
    revalidatePath("/");
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not update subscription",
    };
  }
}

export async function deleteRecurring(id: string) {
  const supabase = await createClient();
  await supabase.from("recurring").delete().eq("id", id);
  revalidatePath("/subscriptions");
}

/**
 * Log the current renewal as a real, paid expense and advance next_renewal_date.
 * The conversion is FROZEN at the payment date's NRB rate (or 1:1 for NPR).
 */
export async function logRenewalPaid(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const id = String(formData.get("recurring_id") ?? "");
  const { data: r } = await supabase
    .from("recurring")
    .select("*")
    .eq("id", id)
    .single();
  if (!r) return;

  const { data: recurringShares } = await supabase
    .from("recurring_shares")
    .select("*")
    .eq("recurring_id", id);

  const amount = n(formData.get("amount")) || Number(r.amount);
  const currency = r.currency as Currency;
  const paidDate =
    String(formData.get("expense_date") ?? "") || r.next_renewal_date;
  const submittedShares = readShareInputs(formData);
  const shares: ShareInput[] =
    submittedShares.length > 0
      ? submittedShares
      : (recurringShares ?? []).map((share: { user_id: string; amount: number }) => ({
          userId: share.user_id,
          amount: Number(share.amount),
        }));
  validateShareTotal(shares, amount);
  const paidByUserId =
    String(formData.get("paid_by_user_id") ?? "") || r.paid_by_user_id;
  let nrbRate = null;
  if (currency === "USD") {
    nrbRate = await getUsdSellRateForDate(supabase, paidDate);
  }
  const conv = resolveConversion({
    amount,
    currency,
    nrbRate,
  });

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      amount,
      currency,
      expense_date: paidDate,
      billing_month:
        billingMonthDate(formData.get("billing_month")) ?? `${paidDate.slice(0, 7)}-01`,
      category_id: r.category_id,
      vendor_id: r.vendor_id,
      paid_by_user_id: paidByUserId,
      source: "recurring",
      recurring_id: r.id,
      created_by: user?.id ?? null,
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

  if (formData.get("update_defaults") === "yes") {
    const { error: recurringError } = await supabase
      .from("recurring")
      .update({ amount, paid_by_user_id: paidByUserId })
      .eq("id", id);
    if (recurringError) throw new Error(recurringError.message);

    const { error: clearError } = await supabase
      .from("recurring_shares")
      .delete()
      .eq("recurring_id", id);
    if (clearError) throw new Error(clearError.message);
    if (shares.length > 0) {
      const { error: defaultShareError } = await supabase.from("recurring_shares").insert(
        shares.map((share) => ({
          recurring_id: id,
          user_id: share.userId,
          amount: share.amount,
        }))
      );
      if (defaultShareError) throw new Error(defaultShareError.message);
    }
  }

  const next =
    r.cycle === "annual"
      ? addYears(parseISO(r.next_renewal_date), 1)
      : addMonths(parseISO(r.next_renewal_date), 1);
  await supabase
    .from("recurring")
    .update({ next_renewal_date: format(next, "yyyy-MM-dd") })
    .eq("id", id);

  revalidatePath("/subscriptions");
  revalidatePath("/expenses");
  revalidatePath("/");
}
