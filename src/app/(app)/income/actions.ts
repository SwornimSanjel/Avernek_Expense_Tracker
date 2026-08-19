"use server";

import { revalidatePath } from "next/cache";
import { exec, one, transaction } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import { addCalendarDays } from "@/lib/income";
import type {
  Currency,
  IncomeAccountType,
  IncomeAgreementStatus,
  IncomePaymentFor,
  IncomeServiceType,
  SetupPaymentTerms,
} from "@/lib/types";

export type IncomeFormState = { error: string | null; ok: string | null };

async function requireIncomeAdmin() {
  const session = await requireSession();
  assertAppOwner(session);
  return session;
}

function stringValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function positiveOrZero(formData: FormData, name: string) {
  const value = Number(formData.get(name));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function paymentAccount(id: string, currency: Currency) {
  if (!id) throw new Error("Choose the company-money account that received this payment.");
  const account = await one<{
    name: string;
    kind: string;
    currency: Currency;
    is_active: boolean;
  }>(
    `select name, kind, currency, is_active from public.money_accounts where id = $1`,
    [id]
  );
  if (!account?.is_active) throw new Error("That company-money account is unavailable.");
  if (account.currency !== currency) {
    throw new Error(`Choose a ${currency} receiving account.`);
  }
  return {
    id,
    name: account.name,
    receivedIn: (account.kind === "personal_custody" ? "personal" : "company") as IncomeAccountType,
  };
}

function agreementValues(formData: FormData) {
  const clientName = stringValue(formData, "client_name");
  const agreementName = stringValue(formData, "agreement_name") || null;
  const serviceType = stringValue(formData, "service_type") as IncomeServiceType;
  const contactName = stringValue(formData, "contact_name") || null;
  const agreementDate = stringValue(formData, "agreement_date");
  const adsLiveDate = stringValue(formData, "ads_live_date");
  const setupDueDate = stringValue(formData, "setup_due_date");
  const setupAmount = positiveOrZero(formData, "setup_amount");
  const recurringAmount = positiveOrZero(formData, "recurring_amount");
  const currency = stringValue(formData, "currency") as Currency;
  const terms = stringValue(formData, "setup_payment_terms") as SetupPaymentTerms;
  const advancePercent = Number(formData.get("setup_advance_percent") ?? 50);
  const dueDays = Number(formData.get("recurring_due_days_before") ?? 0);
  const notes = stringValue(formData, "notes") || null;

  if (!clientName) return { error: "Enter the client name." } as const;
  if (!(["ai_automation", "marketing", "full_track"] as string[]).includes(serviceType)) {
    return { error: "Choose AI automation, marketing, or the full track." } as const;
  }
  if (![agreementDate, adsLiveDate, setupDueDate].every(validDate)) {
    return { error: "Enter the agreement, setup due, and ads-live dates." } as const;
  }
  if (setupAmount == null || recurringAmount == null) {
    return { error: "Setup and recurring amounts must be zero or more." } as const;
  }
  if (!(["NPR", "USD"] as string[]).includes(currency)) {
    return { error: "Choose NPR or USD." } as const;
  }
  if (!(["full_upfront", "half_advance", "custom"] as string[]).includes(terms)) {
    return { error: "Choose valid setup payment terms." } as const;
  }
  if (!Number.isFinite(advancePercent) || advancePercent < 0 || advancePercent > 100) {
    return { error: "Advance percentage must be between 0 and 100." } as const;
  }
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 30) {
    return { error: "Recurring due days must be between 0 and 30." } as const;
  }

  return {
    value: {
      clientName,
      agreementName,
      serviceType,
      contactName,
      agreementDate,
      adsLiveDate,
      setupDueDate,
      setupAmount,
      recurringAmount,
      currency,
      terms,
      advancePercent: terms === "half_advance" ? advancePercent : 100,
      dueDays,
      notes,
    },
  } as const;
}

export async function addIncomeAgreement(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const parsed = agreementValues(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the agreement details.", ok: null };
  const value = parsed.value;
  const initialPaidAmount = positiveOrZero(formData, "initial_paid_amount") ?? 0;
  const initialPaidOn = stringValue(formData, "initial_paid_on");
  const initialMoneyAccountId = stringValue(formData, "initial_money_account_id");

  if (initialPaidAmount > value.setupAmount) {
    return { error: "Paid amount cannot be greater than the first-cycle amount.", ok: null };
  }
  if (initialPaidAmount > 0 && !validDate(initialPaidOn)) {
    return { error: "Enter the date the opening payment was received.", ok: null };
  }
  let initialAccount: Awaited<ReturnType<typeof paymentAccount>> | null = null;
  if (initialPaidAmount > 0) {
    try {
      initialAccount = await paymentAccount(initialMoneyAccountId, value.currency);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Choose the receiving account.", ok: null };
    }
  }

  await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.income_agreements
         (client_name, agreement_name, service_type, contact_name, agreement_date,
          ads_live_date, setup_amount, recurring_amount, currency,
          setup_payment_terms, setup_advance_percent, setup_due_date,
          recurring_due_days_before, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning id`,
      [
        value.clientName,
        value.agreementName,
        value.serviceType,
        value.contactName,
        value.agreementDate,
        value.adsLiveDate,
        value.setupAmount,
        value.recurringAmount,
        value.currency,
        value.terms,
        value.advancePercent,
        value.setupDueDate,
        value.dueDays,
        value.notes,
        session.sub,
      ]
    );

    if (initialPaidAmount > 0) {
      await client.query(
        `insert into public.income_payments
           (agreement_id, payment_for, billing_period_start, amount, paid_on,
            received_in, money_account_id, account_name, note, recorded_by)
         values ($1,'setup',null,$2,$3,$4,$5,$6,$7,$8)`,
        [
          inserted.rows[0].id,
          initialPaidAmount,
          initialPaidOn,
          initialAccount!.receivedIn,
          initialAccount!.id,
          initialAccount!.name,
          "Opening payment recorded with agreement",
          session.sub,
        ]
      );
    }
  });

  revalidatePath("/income");
  revalidatePath("/funds");
  revalidatePath("/");
  return { error: null, ok: `${value.clientName} agreement added.` };
}

export async function updateIncomeAgreement(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  await requireIncomeAdmin();
  const id = stringValue(formData, "agreement_id");
  if (!id) return { error: "Agreement not found.", ok: null };
  const parsed = agreementValues(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the agreement details.", ok: null };
  const value = parsed.value;

  const current = await one<{
    currency: Currency;
    ads_live_date: string;
    recurring_amount: number | string;
    setup_paid: number | string;
    recurring_payment_count: number | string;
  }>(
    `select a.currency, a.ads_live_date, a.recurring_amount,
            coalesce(sum(p.amount) filter (where p.payment_for = 'setup'), 0) as setup_paid,
            count(p.id) filter (where p.payment_for = 'recurring') as recurring_payment_count
       from public.income_agreements a
       left join public.income_payments p on p.agreement_id = a.id
      where a.id = $1
      group by a.id`,
    [id]
  );
  if (!current) return { error: "Agreement no longer exists.", ok: null };
  if (
    current.currency !== value.currency &&
    (Number(current.setup_paid) > 0 || Number(current.recurring_payment_count) > 0)
  ) {
    return { error: "Currency cannot change after payments have been recorded.", ok: null };
  }
  if (Number(current.setup_paid) > value.setupAmount) {
    return { error: "Setup amount cannot be lower than the setup payments already received.", ok: null };
  }
  if (
    Number(current.recurring_payment_count) > 0 &&
    current.ads_live_date !== value.adsLiveDate
  ) {
    return { error: "Ads-live billing date cannot change after recurring payments exist.", ok: null };
  }
  if (
    Number(current.recurring_payment_count) > 0 &&
    Number(current.recurring_amount) !== value.recurringAmount
  ) {
    return {
      error: "Recurring fee cannot change after cycle payments exist. End this service and create a new agreement for the new rate.",
      ok: null,
    };
  }

  const changed = await exec(
    `update public.income_agreements
        set client_name = $1, agreement_name = $2, service_type = $3,
            contact_name = $4, agreement_date = $5, ads_live_date = $6,
            setup_amount = $7, recurring_amount = $8, currency = $9,
            setup_payment_terms = $10, setup_advance_percent = $11,
            setup_due_date = $12, recurring_due_days_before = $13,
            notes = $14, updated_at = now()
      where id = $15`,
    [
      value.clientName,
      value.agreementName,
      value.serviceType,
      value.contactName,
      value.agreementDate,
      value.adsLiveDate,
      value.setupAmount,
      value.recurringAmount,
      value.currency,
      value.terms,
      value.advancePercent,
      value.setupDueDate,
      value.dueDays,
      value.notes,
      id,
    ]
  );

  if (!changed) return { error: "Agreement no longer exists.", ok: null };
  revalidatePath("/income");
  return { error: null, ok: "Agreement updated." };
}

export async function recordIncomePayment(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const agreementId = stringValue(formData, "agreement_id");
  const paymentFor = stringValue(formData, "payment_for") as IncomePaymentFor;
  const billingPeriodStart = stringValue(formData, "billing_period_start");
  const amount = Number(formData.get("amount"));
  const paidOn = stringValue(formData, "paid_on");
  const moneyAccountId = stringValue(formData, "money_account_id");
  const reference = stringValue(formData, "reference") || null;
  const note = stringValue(formData, "note") || null;

  if (!agreementId) return { error: "Agreement not found.", ok: null };
  if (!(["setup", "recurring"] as string[]).includes(paymentFor)) {
    return { error: "Choose setup or recurring payment.", ok: null };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Payment amount must be greater than zero.", ok: null };
  }
  if (!validDate(paidOn)) return { error: "Enter the payment date.", ok: null };
  const agreement = await one<{
    client_name: string;
    ads_live_date: string;
    currency: Currency;
    setup_amount: number | string;
    recurring_amount: number | string;
  }>(
    `select client_name, ads_live_date, currency, setup_amount, recurring_amount
       from public.income_agreements where id = $1`,
    [agreementId]
  );
  if (!agreement) return { error: "Agreement no longer exists.", ok: null };
  let account: Awaited<ReturnType<typeof paymentAccount>>;
  try {
    account = await paymentAccount(moneyAccountId, agreement.currency);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Choose the receiving account.", ok: null };
  }

  let period: string | null = null;
  if (paymentFor === "recurring") {
    if (!validDate(billingPeriodStart)) {
      return { error: "Choose which 30-day service cycle this payment covers.", ok: null };
    }
    const anchored = Array.from({ length: 240 }, (_, index) =>
      addCalendarDays(agreement.ads_live_date, (index + 1) * 30)
    ).includes(billingPeriodStart);
    if (!anchored) {
      return { error: "That billing period is not an exact 30-day cycle from ads-live Day 1.", ok: null };
    }
    period = billingPeriodStart;
  }

  const received = await one<{ paid: number | string }>(
    paymentFor === "setup"
      ? `select coalesce(sum(amount), 0) as paid
           from public.income_payments
          where agreement_id = $1 and payment_for = 'setup'`
      : `select coalesce(sum(amount), 0) as paid
           from public.income_payments
          where agreement_id = $1 and payment_for = 'recurring'
            and billing_period_start = $2`,
    paymentFor === "setup" ? [agreementId] : [agreementId, period]
  );
  const agreed = Number(
    paymentFor === "setup" ? agreement.setup_amount : agreement.recurring_amount
  );
  const remaining = Math.max(0, agreed - Number(received?.paid ?? 0));
  if (amount > remaining) {
    return {
      error: `This payment is more than the remaining ${remaining.toLocaleString("en-NP")} ${paymentFor} balance.`,
      ok: null,
    };
  }

  await exec(
    `insert into public.income_payments
       (agreement_id, payment_for, billing_period_start, amount, paid_on,
        received_in, money_account_id, account_name, reference, note, recorded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      agreementId,
      paymentFor,
      period,
      amount,
      paidOn,
      account.receivedIn,
      account.id,
      account.name,
      reference,
      note,
      session.sub,
    ]
  );

  revalidatePath("/income");
  revalidatePath("/funds");
  revalidatePath("/");
  return { error: null, ok: `Payment recorded for ${agreement.client_name}.` };
}

export async function setIncomeAgreementStatus(
  id: string,
  status: IncomeAgreementStatus
) {
  await requireIncomeAdmin();
  if (!(["active", "paused", "completed"] as string[]).includes(status)) {
    throw new Error("Invalid agreement status.");
  }
  await exec(
    `update public.income_agreements
        set status = $1,
            service_end_date = case
              when $1 = 'active' then null
              else coalesce(service_end_date, current_date)
            end,
            updated_at = now()
      where id = $2`,
    [status, id]
  );
  revalidatePath("/income");
}

export async function deleteIncomePayment(id: string) {
  await requireIncomeAdmin();
  await exec(`delete from public.income_payments where id = $1`, [id]);
  revalidatePath("/income");
  revalidatePath("/funds");
  revalidatePath("/");
}
