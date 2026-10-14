"use server";

import { revalidatePath } from "next/cache";
import { exec, insertRows, one, query, transaction, updateRow } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
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
import { assertAppOwner } from "@/lib/authz";

function n(v: FormDataEntryValue | null): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** recurring_shares rows for a subscription. */
function shareRows(recurringId: string, shares: ShareInput[]) {
  return shares.map((share) => ({
    recurring_id: recurringId,
    user_id: share.userId,
    amount: share.amount,
  }));
}

export async function addRecurring(formData: FormData) {
  const session = await requireSession();

  const amount = n(formData.get("amount"));
  const shares = readShareInputs(formData);
  validateShareTotal(shares, amount);

  try {
    await transaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into public.recurring
           (name, amount, currency, cycle, next_renewal_date,
            category_id, vendor_id, paid_by_user_id, is_active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true)
         returning id`,
        [
          (formData.get("name") as string) || "Subscription",
          amount,
          (formData.get("currency") as Currency) || "NPR",
          (formData.get("cycle") as Cycle) || "monthly",
          (formData.get("next_renewal_date") as string) ||
            new Date().toISOString().slice(0, 10),
          (formData.get("category_id") as string) || null,
          (formData.get("vendor_id") as string) || null,
          (formData.get("paid_by_user_id") as string) || session.sub,
          ]
      );

      if (shares.length > 0) {
        await insertRows(
          "public.recurring_shares",
          shareRows(inserted.rows[0].id, shares),
          client
        );
      }
    });
  } catch (error) {
    // The subscription and its split are now written atomically, so a failure
    // means nothing was saved — no more "saved without its person split".
    return {
      error:
        error instanceof Error
          ? `Could not save the subscription: ${error.message}`
          : "Could not save the subscription.",
    };
  }

  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { error: null };
}

export async function toggleActive(id: string, value: boolean) {
  const session = await requireSession();
  assertAppOwner(session);

  await exec(`update public.recurring set is_active = $1 where id = $2`, [
    value,
    id,
  ]);

  revalidatePath("/subscriptions");
  revalidatePath("/");
}

export async function updateRecurring(formData: FormData) {
  try {
    const session = await requireSession();
    assertAppOwner(session);

    const id = String(formData.get("recurring_id") ?? "");
    const amount = n(formData.get("amount"));
    const shares = readShareInputs(formData);
    validateShareTotal(shares, amount);

    await transaction(async (client) => {
      await updateRow(
        "public.recurring",
        {
          name: String(formData.get("name") ?? "").trim() || "Subscription",
          amount,
          currency: (formData.get("currency") as Currency) || "NPR",
          cycle: (formData.get("cycle") as Cycle) || "monthly",
          next_renewal_date:
            String(formData.get("next_renewal_date") ?? "") ||
            new Date().toISOString().slice(0, 10),
          category_id: String(formData.get("category_id") ?? "") || null,
          vendor_id: String(formData.get("vendor_id") ?? "") || null,
          paid_by_user_id:
            String(formData.get("paid_by_user_id") ?? "") || null,
        },
        id,
        client
      );

      await client.query(
        `delete from public.recurring_shares where recurring_id = $1`,
        [id]
      );

      if (shares.length > 0) {
        await insertRows(
          "public.recurring_shares",
          shareRows(id, shares),
          client
        );
      }
    });

    revalidatePath("/subscriptions");
    revalidatePath("/");
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not update subscription",
    };
  }
}

export async function deleteRecurring(id: string) {
  const session = await requireSession();
  assertAppOwner(session);

  await exec(`delete from public.recurring where id = $1`, [id]);
  revalidatePath("/subscriptions");
}

/**
 * Log the current renewal as a real, paid expense and advance next_renewal_date.
 * The conversion is FROZEN at the payment date's NRB rate (or 1:1 for NPR).
 */
export async function logRenewalPaid(formData: FormData) {
  const session = await requireSession();
  assertAppOwner(session);

  const id = String(formData.get("recurring_id") ?? "");

  const r = await one<{
    id: string;
    amount: string | number;
    currency: string;
    cycle: string;
    next_renewal_date: string;
    category_id: string | null;
    vendor_id: string | null;
    paid_by_user_id: string | null;
  }>(`select * from public.recurring where id = $1`, [id]);

  if (!r) return;

  const recurringShares = await query<{ user_id: string; amount: string | number }>(
    `select * from public.recurring_shares where recurring_id = $1`,
    [id]
  );

  const amount = n(formData.get("amount")) || Number(r.amount);
  const currency = r.currency as Currency;
  const nextRenewalDate = String(r.next_renewal_date).slice(0, 10);
  const paidDate =
    String(formData.get("expense_date") ?? "") || nextRenewalDate;

  const submittedShares = readShareInputs(formData);
  const shares: ShareInput[] =
    submittedShares.length > 0
      ? submittedShares
      : recurringShares.map((share) => ({
          userId: share.user_id,
          amount: Number(share.amount),
        }));

  validateShareTotal(shares, amount);

  const paidByUserId =
    String(formData.get("paid_by_user_id") ?? "") || r.paid_by_user_id;

  let nrbRate = null;
  if (currency === "USD") {
    nrbRate = await getUsdSellRateForDate(paidDate);
  }

  const conv = resolveConversion({ amount, currency, nrbRate });

  const next =
    r.cycle === "annual"
      ? addYears(parseISO(nextRenewalDate), 1)
      : addMonths(parseISO(nextRenewalDate), 1);

  // Expense, its shares, the optional default update and the renewal advance
  // are one unit. Half of this applying would either double-charge the next
  // renewal or record a payment with no split.
  await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.expenses
         (amount, currency, expense_date, billing_month, category_id, vendor_id,
          paid_by_user_id, source, recurring_id, created_by,
          amount_npr, fx_rate_to_npr, fx_rate_date, fx_source, conversion_status,
          actual_npr_charged)
       values ($1,$2,$3,$4,$5,$6,$7,'recurring',$8,$9,$10,$11,$12,$13,$14,$15)
       returning id`,
      [
        amount,
        currency,
        paidDate,
        billingMonthDate(formData.get("billing_month")) ??
          `${paidDate.slice(0, 7)}-01`,
        r.category_id,
        r.vendor_id,
        paidByUserId,
        r.id,
        session.sub,
        conv.amount_npr,
        conv.fx_rate_to_npr,
        conv.fx_rate_date,
        conv.fx_source,
        conv.conversion_status,
        conv.actual_npr_charged,
      ]
    );

    if (shares.length > 0) {
      await insertRows(
        "public.expense_shares",
        toExpenseShareRows(inserted.rows[0].id, shares, amount, conv.amount_npr),
        client
      );
    }

    if (formData.get("update_defaults") === "yes") {
      await updateRow(
        "public.recurring",
        { amount, paid_by_user_id: paidByUserId },
        id,
        client
      );

      await client.query(
        `delete from public.recurring_shares where recurring_id = $1`,
        [id]
      );

      if (shares.length > 0) {
        await insertRows(
          "public.recurring_shares",
          shareRows(id, shares),
          client
        );
      }
    }

    await client.query(
      `update public.recurring set next_renewal_date = $1 where id = $2`,
      [format(next, "yyyy-MM-dd"), id]
    );
  });

  revalidatePath("/subscriptions");
  revalidatePath("/expenses");
  revalidatePath("/");
}
