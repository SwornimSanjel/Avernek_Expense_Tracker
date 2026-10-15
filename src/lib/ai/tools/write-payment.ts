import { z } from "zod";
import { recordIncomePayment, updateIncomePayment } from "@/app/(app)/income/actions";
import { AGREEMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, servicesLabel } from "@/lib/income";
import { toPaisa } from "@/lib/money";
import { billFromBankTotal, round2, tdsOn, vatOn } from "@/lib/tax";
import type { IncomeAgreement, IncomePayment, IncomePaymentMethod, MoneyAccount } from "@/lib/types";
import { RequestData } from "../data";
import { formatDate, formatMonth, isValidDate } from "../dates";
import { money } from "../format";
import { matchOne } from "../match";
import type { FieldOption, FieldSpec } from "../types";
import { clean, isoDate, resolveClient } from "./common";
import type { ExecuteResult, ToolAsk, ToolContext, ToolReady, WriteTool } from "./types";

/**
 * Recording and correcting client payments, with the Record Payment form's
 * rules and defaults:
 *   - the amount is the bill amount EXCLUDING VAT (the form's default entry);
 *     "received 39,025 in the bank" works backwards, as the form's bank mode;
 *   - VAT 13% is added when the money arrives in the company bank (VAT)
 *     account; TDS 1.5% is withheld when the client deducts TDS;
 *   - the account defaults to the client's default account; the date to today;
 *     the method to bank transfer; a monthly fee to the next month due.
 * Every default is shown on the confirmation. The recordIncomePayment action
 * then re-checks everything, including that no more is paid than is owed.
 */

const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as IncomePaymentMethod[];
const STATE = { error: null, ok: null };

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function yesNo(value: unknown): boolean | null {
  if (value === true || value === "yes" || value === "true") return true;
  if (value === false || value === "no" || value === "false") return false;
  return null;
}

function agreementOption(agreement: IncomeAgreement): FieldOption {
  return {
    value: agreement.id,
    label: agreement.agreement_name ? `${agreement.client_name} · ${agreement.agreement_name}` : agreement.client_name,
    hint: [servicesLabel(agreement), AGREEMENT_STATUS_LABELS[agreement.status]].filter(Boolean).join(" · "),
  };
}

const PAYMENT_FOR = ["setup", "website", "recurring"] as const;
type PaymentFor = (typeof PAYMENT_FOR)[number];

// ---------------------------------------------------------------------------

const recordSchema = z.object({
  client: z.string().max(120).optional().describe("Client name as said; use the conversation's client for follow-ups"),
  payment_for: z.enum(PAYMENT_FOR).optional().describe("setup, website or recurring (monthly fee); omit if not said"),
  stream: z.enum(["combined", "ads", "automation"]).optional().describe("Monthly fee stream, if said"),
  period_start: isoDate.optional().describe("First day of the month being paid, if said"),
  amount: z.number().positive().optional(),
  amount_basis: z
    .enum(["bill", "bank"])
    .optional()
    .describe("bill = the amount excluding VAT (default); bank = what actually reached the bank"),
  paid_on: isoDate.optional().describe("Date received; omit if not said (defaults to today)"),
  account: z.string().max(80).optional().describe("Receiving account name, if said"),
  method: z.enum(METHODS as [IncomePaymentMethod, ...IncomePaymentMethod[]]).optional(),
  reference: z.string().max(120).optional(),
  note: z.string().max(300).optional(),
  vat: z.enum(["yes", "no"]).optional().describe("Whether a 13% VAT bill applies, only if the user said"),
  tds: z.enum(["yes", "no"]).optional().describe("Whether the client withheld 1.5% TDS, only if the user said"),
  vat_amount: z.number().min(0).optional().describe("Exact VAT, only if the user gave a figure"),
  tds_amount: z.number().min(0).optional().describe("Exact TDS, only if the user gave a figure"),
});

type NewPayment = {
  agreement_id: string;
  payment_for: PaymentFor;
  billing_stream: string | null;
  billing_period_start: string | null;
  amount: number;
  vat_amount: number;
  tds_amount: number;
  paid_on: string;
  money_account_id: string;
  method: IncomePaymentMethod;
  reference: string | null;
  note: string | null;
};

async function loadPaymentRefs(ctx: ToolContext) {
  const [agreements, summaries, accounts, payments] = await Promise.all([
    ctx.data.agreements(),
    ctx.data.summaries(),
    ctx.data.moneyAccounts(),
    ctx.data.payments(),
  ]);
  return { agreements, summaries, accounts, payments };
}

export const recordClientPayment: WriteTool = {
  name: "record_client_payment",
  label: "Record client payment",
  kind: "write",
  permission: "admin",
  description:
    "Prepare a payment received from a client (setup charge, website or monthly fee). Pass only what the user said; the app works out what it pays, asks for anything missing, applies the usual VAT/TDS rules and shows a confirmation with bill, VAT, TDS and bank amounts. Never claim it is recorded.",
  schema: recordSchema,
  async run(raw, ctx) {
    const v = clean(raw);
    if (v._edit === true || v._edit === "true") {
      if (v.vat === undefined && v.vat_amount !== undefined) v.vat = Number(v.vat_amount) > 0 ? "yes" : "no";
      if (v.tds === undefined && v.tds_amount !== undefined) v.tds = Number(v.tds_amount) > 0 ? "yes" : "no";
      delete v.vat_amount;
      delete v.tds_amount;
    }
    const { agreements, summaries, accounts } = await loadPaymentRefs(ctx);

    // 1. The agreement being paid.
    let agreement = typeof v.agreement_id === "string" ? agreements.find((a) => a.id === v.agreement_id) : undefined;
    if (typeof v.agreement_id === "string" && !agreement) return { status: "error", summary: "That client agreement no longer exists." };
    if (!agreement) {
      let candidates: IncomeAgreement[];
      let message: string;
      if (typeof v.client === "string") {
        const found = await resolveClient(ctx, v.client, "record_client_payment", v);
        if ("status" in found) return found;
        const open = found.client.agreements.filter((a) => a.status !== "cancelled" && a.status !== "completed");
        candidates = open.length ? open : found.client.agreements;
        message = `${found.client.name} has more than one agreement. Which one is this payment for?`;
      } else {
        candidates = agreements.filter((a) => a.status === "active" || a.status === "paused" || a.status === "pending");
        message = "Which client paid?";
      }
      if (candidates.length === 1) agreement = candidates[0];
      else {
        return {
          status: "needs_choice",
          summary: message,
          form: {
            tool: "record_client_payment",
            title: "Which client?",
            message,
            values: v,
            fields: [{ name: "agreement_id", label: "Client", type: "choice", required: true, options: candidates.map(agreementOption) }],
            submitLabel: "Continue",
          },
        };
      }
    }
    const summary = summaries.get(agreement.id)!;
    const currency = agreement.currency;

    // 2. What it pays: the targets the Record Payment form offers.
    const streams = summary.recurring.streams.filter((stream) => stream.billingStartDate);
    const hasMonthly = agreement.has_ads || agreement.has_automation;
    const recurringOwed = streams.reduce(
      (sum, stream) => sum + stream.periods.reduce((s, p) => s + Math.max(0, p.remaining), 0),
      0
    );
    const targets: { value: PaymentFor; label: string; remaining: number }[] = [
      ...(hasMonthly || summary.setup.agreed > 0 ? [{ value: "setup" as const, label: "Setup · month 1", remaining: summary.setup.remaining }] : []),
      ...(streams.length ? [{ value: "recurring" as const, label: "Monthly fee", remaining: recurringOwed }] : []),
      ...(summary.website ? [{ value: "website" as const, label: "Website", remaining: summary.website.remaining }] : []),
    ];
    const owed = targets.filter((target) => target.remaining > 0.004);
    if (!owed.length) {
      return {
        status: "error",
        summary: `Nothing is owed by ${agreement.client_name} right now. Record an advance payment on the Income page.`,
      };
    }
    const errors: Record<string, string> = {};
    const defaulted: string[] = [];
    let paymentFor: PaymentFor | null = null;
    if (typeof v.payment_for === "string" && PAYMENT_FOR.includes(v.payment_for as PaymentFor)) {
      const target = targets.find((t) => t.value === v.payment_for);
      if (!target) errors.payment_for = `${agreement.client_name} has no ${v.payment_for} charge.`;
      else if (target.remaining <= 0.004) errors.payment_for = `The ${target.label.toLowerCase()} is already paid.`;
      else paymentFor = target.value;
    } else if (owed.length === 1) {
      paymentFor = owed[0].value;
    }

    // 3. For a monthly fee: which service and which month.
    let stream = null as (typeof streams)[number] | null;
    let period = null as (typeof streams)[number]["periods"][number] | null;
    if (paymentFor === "recurring") {
      const wantedStream = str(v.billing_stream) ?? str(v.stream);
      stream = streams.find((s) => s.key === wantedStream) ?? (streams.length === 1 ? streams[0] : null);
      if (wantedStream && !streams.some((s) => s.key === wantedStream)) errors.billing_stream = "Choose the service.";
      if (stream) {
        const open = stream.periods.filter((p) => p.remaining > 0.004);
        const wantedPeriod = str(v.billing_period_start) ?? str(v.period_start);
        period = open.find((p) => p.periodStart === wantedPeriod) ?? null;
        if (wantedPeriod && !period) errors.billing_period_start = "That month is not owed; choose one.";
        if (!period && !wantedPeriod) {
          const next = summary.recurring.nextDuePeriod;
          period = (next && next.stream === stream.key ? open.find((p) => p.periodStart === next.periodStart) : null) ?? open[0] ?? null;
          if (period) defaulted.push("period");
        }
        if (!open.length) errors.billing_stream = `Nothing is owed on the ${stream.label.toLowerCase()}.`;
      }
    }
    const remaining =
      paymentFor === "setup"
        ? summary.setup.remaining
        : paymentFor === "website"
          ? summary.website?.remaining ?? 0
          : period?.remaining ?? 0;

    // 4. The receiving account.
    const usable = accounts.filter((a) => a.is_active && a.currency === currency);
    let account: MoneyAccount | undefined;
    if (typeof v.money_account_id === "string") {
      account = usable.find((a) => a.id === v.money_account_id);
      if (!account) errors.money_account_id = "Choose the receiving account.";
    } else if (typeof v.account === "string") {
      const match = matchOne(usable, (a) => [a.name], v.account);
      if (match.kind === "one") account = match.item;
      else errors.money_account_id = `Could not tell which account "${v.account}" is; choose it.`;
    } else {
      account = usable.find((a) => a.id === agreement!.default_money_account_id) ?? (usable.length === 1 ? usable[0] : undefined);
      if (account) defaulted.push("account");
    }

    // 5. Amount, VAT and TDS.
    let withVat = yesNo(v.vat);
    if (withVat == null && num(v.vat_amount) == null) {
      withVat = account?.kind === "company_bank";
      defaulted.push("vat");
    }
    let withTds = yesNo(v.tds);
    if (withTds == null && num(v.tds_amount) == null) {
      withTds = agreement.deducts_tds;
      defaulted.push("tds");
    }
    const given = num(v.amount);
    const basis = v.amount_basis === "bank" ? "bank" : "bill";
    let bill: number | null = given;
    if (given != null && basis === "bank") bill = billFromBankTotal(given, Boolean(withVat), Boolean(withTds));
    if (bill != null && bill <= 0) errors.amount = "Must be more than zero.";
    const vat = num(v.vat_amount) ?? (withVat && bill ? vatOn(bill) : 0);
    const tds = num(v.tds_amount) ?? (withTds && bill ? tdsOn(bill) : 0);
    if (bill != null && paymentFor && bill > remaining + 0.001) {
      errors.amount = `Only ${money(remaining, currency)} is still owed on this (excluding VAT).`;
    }
    if (bill != null && tds > bill + vat + 0.001) errors.amount = "TDS cannot be more than the amount received.";

    let paidOn = str(v.paid_on);
    if (paidOn && !isValidDate(paidOn)) {
      errors.paid_on = "Not a real date.";
      paidOn = null;
    }
    if (!paidOn && !errors.paid_on) {
      paidOn = ctx.today;
      defaulted.push("date");
    }
    const method = METHODS.includes(v.method as IncomePaymentMethod) ? (v.method as IncomePaymentMethod) : "bank_transfer";

    const missing: string[] = [];
    if (!paymentFor) missing.push("payment_for");
    if (paymentFor === "recurring" && !stream) missing.push("billing_stream");
    if (paymentFor === "recurring" && stream && !period) missing.push("billing_period_start");
    if (!account) missing.push("money_account_id");
    if (bill == null) missing.push("amount");

    // A defaulted value stays unset in the form's hidden values, so the next
    // round defaults it again and the confirmation still says so.
    const showAll = v._edit === true || v._edit === "true";
    const unlessDefaulted = (what: string, value: unknown) => (!showAll && defaulted.includes(what) ? "" : value);
    const values: Record<string, unknown> = {
      agreement_id: agreement.id,
      payment_for: paymentFor ?? "",
      billing_stream: stream?.key ?? "",
      billing_period_start: unlessDefaulted("period", period?.periodStart ?? ""),
      amount: bill ?? "",
      money_account_id: unlessDefaulted("account", account?.id ?? ""),
      vat: unlessDefaulted("vat", withVat == null ? (vat > 0 ? "yes" : "no") : withVat ? "yes" : "no"),
      tds: unlessDefaulted("tds", withTds == null ? (tds > 0 ? "yes" : "no") : withTds ? "yes" : "no"),
      paid_on: unlessDefaulted("date", paidOn ?? ""),
      method,
      reference: str(v.reference) ?? "",
      note: str(v.note) ?? "",
    };
    if (missing.length || Object.keys(errors).length || showAll) {
      const fields: FieldSpec[] = [
        {
          name: "payment_for",
          label: "What does it pay?",
          type: "choice",
          required: true,
          options: targets.map((t) => ({ value: t.value, label: t.label, hint: `${money(t.remaining, currency)} owed` })),
          value: String(values.payment_for),
        },
        ...(paymentFor === "recurring" || showAll
          ? [
              {
                name: "billing_stream",
                label: "Which service?",
                type: "choice" as const,
                required: paymentFor === "recurring",
                options: streams.map((s) => ({ value: s.key, label: s.label })),
                value: String(values.billing_stream),
              },
              {
                name: "billing_period_start",
                label: "Which month?",
                type: "select" as const,
                required: paymentFor === "recurring",
                options: (stream?.periods ?? [])
                  .filter((p) => p.remaining > 0.004)
                  .map((p) => ({
                    value: p.periodStart,
                    label: `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`,
                    hint: `${money(p.remaining, currency)} owed${p.status === "overdue" ? " · overdue" : ""}`,
                  })),
                value: String(values.billing_period_start),
              },
            ]
          : []),
        {
          name: "amount",
          label: `Bill amount, excluding VAT (${currency})`,
          type: "number",
          required: true,
          min: 0.01,
          step: 0.01,
          value: String(values.amount),
          help: paymentFor ? `${money(remaining, currency)} is still owed on this.` : undefined,
        },
        {
          name: "money_account_id",
          label: "Received in",
          type: "select",
          required: true,
          options: usable.map((a) => ({ value: a.id, label: a.name })),
          value: String(values.money_account_id),
        },
        {
          name: "vat",
          label: "13% VAT bill issued?",
          type: "choice",
          required: true,
          options: [
            { value: "yes", label: "Yes, add 13% VAT" },
            { value: "no", label: "No VAT" },
          ],
          value: String(values.vat),
          help: "Usually yes when the money arrives in the company bank (VAT) account.",
        },
        {
          name: "tds",
          label: "Client withheld 1.5% TDS?",
          type: "choice",
          required: true,
          options: [
            { value: "yes", label: "Yes, 1.5% TDS withheld" },
            { value: "no", label: "No TDS" },
          ],
          value: String(values.tds),
        },
        { name: "paid_on", label: "Date received", type: "date", required: true, value: String(values.paid_on) },
        {
          name: "method",
          label: "Method",
          type: "select",
          required: true,
          options: METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
          value: String(values.method),
        },
        { name: "reference", label: "Reference", type: "text", required: false, value: String(values.reference), placeholder: "Transaction or bill no." },
        { name: "note", label: "Note", type: "text", required: false, value: String(values.note) },
      ];
      const shown = fields
        .filter((field) => showAll || missing.includes(field.name) || errors[field.name])
        .map((field) => ({ ...field, error: errors[field.name] }));
      return {
        status: "needs_input",
        summary: showAll ? "Edit the payment, then review it again." : `A few details are needed to record ${agreement.client_name}'s payment.`,
        form: {
          tool: "record_client_payment",
          title: showAll ? "Edit payment" : `Payment from ${agreement.client_name}`,
          message: showAll ? undefined : "Fill in what's missing. Nothing is recorded until you confirm.",
          values: { ...values, _edit: false },
          fields: shown,
          submitLabel: "Review",
        },
      } satisfies ToolAsk;
    }

    const payment: NewPayment = {
      agreement_id: agreement.id,
      payment_for: paymentFor!,
      billing_stream: stream?.key ?? null,
      billing_period_start: period?.periodStart ?? null,
      amount: round2(bill!),
      vat_amount: round2(vat),
      tds_amount: round2(tds),
      paid_on: paidOn!,
      money_account_id: account!.id,
      method,
      reference: str(v.reference),
      note: str(v.note),
    };
    const bank = (toPaisa(payment.amount) + toPaisa(payment.vat_amount) - toPaisa(payment.tds_amount)) / 100;
    const forLabel =
      payment.payment_for === "recurring"
        ? `${stream!.label} · ${formatMonth(period!.periodStart)}${defaulted.includes("period") ? " (next month due)" : ""}`
        : targets.find((t) => t.value === payment.payment_for)!.label;
    const leftAfter = Math.max(0, (toPaisa(remaining) - toPaisa(payment.amount)) / 100);
    const warnings: string[] = [];
    if (defaulted.includes("vat") && payment.vat_amount > 0) warnings.push("13% VAT was added because the money arrives in the company bank (VAT) account.");
    if (defaulted.includes("tds") && payment.tds_amount > 0) warnings.push("1.5% TDS was applied because this client deducts TDS.");
    if (basis === "bank") warnings.push(`Worked back from ${money(given!, currency)} received in the bank.`);
    if (defaulted.includes("date")) warnings.push("No date was given, so it is recorded as received today.");

    return {
      status: "ready",
      summary: `Ready to record ${money(payment.amount, currency)} from ${agreement.client_name}. Please confirm.`,
      draft: {
        title: "Confirm payment",
        confirmLabel: "Record payment",
        rows: [
          { label: "Client", value: agreement.client_name },
          { label: "For", value: forLabel },
          { label: "Bill amount (excl. VAT)", value: money(payment.amount, currency) },
          { label: "VAT", value: payment.vat_amount ? money(payment.vat_amount, currency) : "No VAT" },
          { label: "TDS withheld", value: payment.tds_amount ? money(payment.tds_amount, currency) : "No TDS" },
          { label: "Reaches the bank", value: money(bank, currency) },
          { label: "Received in", value: `${account!.name}${defaulted.includes("account") ? " (client's default)" : ""}` },
          { label: "Date received", value: `${formatDate(payment.paid_on)}${defaulted.includes("date") ? " (today)" : ""}` },
          { label: "Method", value: PAYMENT_METHOD_LABELS[payment.method] },
          ...(payment.reference ? [{ label: "Reference", value: payment.reference }] : []),
          ...(payment.note ? [{ label: "Note", value: payment.note }] : []),
          { label: "Still owed on this after", value: money(leftAfter, currency) },
        ],
        warnings,
        args: payment as unknown as Record<string, unknown>,
      },
    } satisfies ToolReady;
  },

  async execute(args) {
    const payment = args as unknown as NewPayment;
    const form = new FormData();
    form.set("agreement_id", payment.agreement_id);
    form.set("payment_for", payment.payment_for);
    form.set("billing_stream", payment.billing_stream ?? "");
    form.set("billing_period_start", payment.billing_period_start ?? "");
    form.set("amount", String(payment.amount));
    form.set("vat_amount", String(payment.vat_amount));
    form.set("tds_amount", String(payment.tds_amount));
    form.set("paid_on", payment.paid_on);
    form.set("money_account_id", payment.money_account_id);
    form.set("method", payment.method);
    form.set("reference", payment.reference ?? "");
    form.set("note", payment.note ?? "");
    const result = await recordIncomePayment(STATE, form);
    if (result.error) return { ok: false, error: result.error };
    return { ok: true, text: result.ok ?? "Payment recorded." };
  },
};

// ---------------------------------------------------------------------------

const updateSchema = z.object({
  client: z.string().max(120).optional(),
  payment_id: z.string().uuid().optional().describe("Only if known from an earlier choice"),
  match_paid_on: isoDate.optional().describe("Date of the payment to change, if said"),
  match_amount: z.number().positive().optional().describe("Current amount of the payment to change, if said"),
  new_amount: z.number().positive().optional().describe("New bill amount excluding VAT"),
  new_paid_on: isoDate.optional(),
  new_account: z.string().max(80).optional(),
  new_method: z.enum(METHODS as [IncomePaymentMethod, ...IncomePaymentMethod[]]).optional(),
  new_reference: z.string().max(120).optional(),
  new_note: z.string().max(300).optional(),
  new_vat_amount: z.number().min(0).optional(),
  new_tds_amount: z.number().min(0).optional(),
});

const PAYMENT_FIELDS = ["amount", "vat_amount", "tds_amount", "paid_on", "money_account_id", "method", "reference", "note"] as const;
type PaymentField = (typeof PAYMENT_FIELDS)[number];

function currentValue(payment: IncomePayment, field: PaymentField): string {
  if (field === "amount" || field === "vat_amount" || field === "tds_amount") return String(Number(payment[field] ?? 0));
  return String(payment[field] ?? "");
}

function describePayment(payment: IncomePayment, agreement: IncomeAgreement | undefined): string {
  const forLabel = payment.payment_for === "setup" ? "Setup" : payment.payment_for === "website" ? "Website" : "Monthly fee";
  return [formatDate(payment.paid_on), agreement?.client_name, forLabel, money(Number(payment.amount), agreement?.currency ?? "NPR")]
    .filter(Boolean)
    .join(" · ");
}

export const updateClientPayment: WriteTool = {
  name: "update_client_payment",
  label: "Correct client payment",
  kind: "write",
  permission: "admin",
  description:
    "Prepare a correction to a recorded client payment (amount, VAT, TDS, date, account, method, reference, note). Identify it by client and match_* details; the app asks which one when several fit and shows old → new for confirmation. Never claim it is changed.",
  schema: updateSchema,
  async run(raw, ctx) {
    const v = clean(raw);
    const { agreements, payments, accounts } = await loadPaymentRefs(ctx);
    const agreementById = new Map(agreements.map((a) => [a.id, a]));

    let payment = typeof v.payment_id === "string" ? payments.find((p) => p.id === v.payment_id) : undefined;
    if (typeof v.payment_id === "string" && !payment) return { status: "error", summary: "That payment no longer exists." };
    if (!payment) {
      let candidates = payments;
      if (typeof v.client === "string") {
        const found = await resolveClient(ctx, v.client, "update_client_payment", v);
        if ("status" in found) return found;
        const ids = new Set(found.client.agreements.map((a) => a.id));
        candidates = candidates.filter((p) => ids.has(p.agreement_id));
      }
      if (typeof v.match_paid_on === "string") candidates = candidates.filter((p) => p.paid_on === v.match_paid_on);
      const matchAmount = num(v.match_amount);
      if (matchAmount != null) candidates = candidates.filter((p) => toPaisa(p.amount) === toPaisa(matchAmount));
      const narrowed = ["match_paid_on", "match_amount"].some((key) => key in v);
      if (narrowed && candidates.length === 1) payment = candidates[0];
      else if (!candidates.length) return { status: "error", summary: "No recorded payment matches that." };
      else {
        return {
          status: "needs_choice",
          summary: "Which payment should change?",
          form: {
            tool: "update_client_payment",
            title: "Which payment?",
            message: "Most recent first.",
            values: { ...v, payment_id: undefined },
            fields: [
              {
                name: "payment_id",
                label: "Payment",
                type: "choice",
                required: true,
                options: candidates.slice(0, 15).map((p) => ({ value: p.id, label: describePayment(p, agreementById.get(p.agreement_id)) })),
              },
            ],
            submitLabel: "Continue",
          },
        };
      }
    }
    const current = payment;
    const agreement = agreementById.get(current.agreement_id);
    const currency = agreement?.currency ?? "NPR";
    const usable = accounts.filter((a) => a.is_active && a.currency === currency);

    const showAll = v._edit === true || v._edit === "true";
    const errors: Record<string, string> = {};
    const next: Partial<Record<PaymentField, string>> = {};
    const take = (field: PaymentField, fromRequest: unknown) => {
      const value = field in v ? v[field] : fromRequest;
      if (value === undefined) return;
      next[field] = String(value ?? "");
    };
    take("amount", v.new_amount);
    take("vat_amount", v.new_vat_amount);
    take("tds_amount", v.new_tds_amount);
    take("paid_on", v.new_paid_on);
    take("method", v.new_method);
    take("reference", v.new_reference);
    take("note", v.new_note);
    if ("money_account_id" in v) next.money_account_id = String(v.money_account_id ?? "");
    else if (typeof v.new_account === "string") {
      const match = matchOne(usable, (a) => [a.name], v.new_account);
      if (match.kind === "one") next.money_account_id = match.item.id;
      else errors.money_account_id = `Could not tell which account "${v.new_account}" is; choose it.`;
    }
    for (const field of ["amount", "vat_amount", "tds_amount"] as const) {
      if (next[field] === undefined) continue;
      const n = num(next[field]);
      if (n == null || n < 0 || (field === "amount" && n === 0)) errors[field] = field === "amount" ? "Must be more than zero." : "Zero or more.";
      else next[field] = String(round2(n));
    }
    if (next.paid_on !== undefined && !isValidDate(next.paid_on)) errors.paid_on = "Not a real date.";
    if (next.method !== undefined && !METHODS.includes(next.method as IncomePaymentMethod)) errors.method = "Choose a method.";
    if (next.money_account_id !== undefined && next.money_account_id && !usable.some((a) => a.id === next.money_account_id)) {
      errors.money_account_id = "Choose the receiving account.";
    }

    const changes = Object.fromEntries(
      Object.entries(next).filter(([field, value]) => value !== currentValue(current, field as PaymentField))
    ) as Partial<Record<PaymentField, string>>;

    if (!Object.keys(changes).length || Object.keys(errors).length || showAll) {
      const values: Record<string, unknown> = { payment_id: current.id, _edit: false };
      for (const field of PAYMENT_FIELDS) values[field] = next[field] ?? currentValue(current, field);
      const fields: FieldSpec[] = (
        [
          { name: "amount", label: `Bill amount, excluding VAT (${currency})`, type: "number", required: true, min: 0.01, step: 0.01 },
          { name: "vat_amount", label: "VAT", type: "number", required: true, min: 0, step: 0.01 },
          { name: "tds_amount", label: "TDS withheld", type: "number", required: true, min: 0, step: 0.01 },
          { name: "paid_on", label: "Date received", type: "date", required: true },
          { name: "money_account_id", label: "Received in", type: "select", required: true, options: usable.map((a) => ({ value: a.id, label: a.name })) },
          { name: "method", label: "Method", type: "select", required: true, options: METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })) },
          { name: "reference", label: "Reference", type: "text", required: false },
          { name: "note", label: "Note", type: "text", required: false },
        ] as FieldSpec[]
      ).map((field) => ({ ...field, value: String(values[field.name] ?? ""), error: errors[field.name] }));
      return {
        status: "needs_input",
        summary: Object.keys(errors).length ? "Some of the new values need fixing." : "What should change on this payment?",
        form: {
          tool: "update_client_payment",
          title: "Correct payment",
          message: describePayment(current, agreement),
          values,
          fields,
          submitLabel: "Review",
        },
      };
    }

    const NAMES: Record<PaymentField, string> = {
      amount: "Bill amount (excl. VAT)",
      vat_amount: "VAT",
      tds_amount: "TDS withheld",
      paid_on: "Date received",
      money_account_id: "Received in",
      method: "Method",
      reference: "Reference",
      note: "Note",
    };
    const show = (field: PaymentField, value: string) => {
      if (field === "amount" || field === "vat_amount" || field === "tds_amount") return money(Number(value || 0), currency);
      if (field === "paid_on") return formatDate(value);
      if (field === "money_account_id") return accounts.find((a) => a.id === value)?.name ?? "—";
      if (field === "method") return PAYMENT_METHOD_LABELS[value as IncomePaymentMethod] ?? "—";
      return value || "—";
    };
    const warnings: string[] = [];
    if (changes.amount && changes.vat_amount === undefined && changes.tds_amount === undefined && (Number(current.vat_amount) > 0 || Number(current.tds_amount) > 0)) {
      warnings.push("VAT and TDS stay as they are. Change them too if the bill amount changed.");
    }
    return {
      status: "ready",
      summary: `Ready to correct ${describePayment(current, agreement)}. Please confirm.`,
      draft: {
        title: "Confirm correction",
        confirmLabel: "Save correction",
        rows: [
          { label: "Payment", value: describePayment(current, agreement) },
          ...(Object.entries(changes) as [PaymentField, string][]).map(([field, value]) => ({
            label: NAMES[field],
            value: `${show(field, currentValue(current, field))} → ${show(field, value)}`,
          })),
        ],
        warnings,
        // Flat, so "Edit" can send it back as form values.
        args: { payment_id: current.id, ...changes },
      },
    };
  },

  async execute(args, ctx): Promise<ExecuteResult> {
    const { payment_id: rawId, ...rest } = args;
    const id = String(rawId ?? "");
    const changes = Object.fromEntries(
      Object.entries(rest).filter(([field]) => (PAYMENT_FIELDS as readonly string[]).includes(field))
    ) as Partial<Record<PaymentField, string>>;
    const payment = (await new RequestData(ctx.today).payments()).find((p) => p.id === id);
    if (!payment) return { ok: false, error: "That payment no longer exists." };
    // The update action rewrites these fields together: send every current
    // value, with only the confirmed ones changed.
    const form = new FormData();
    form.set("payment_id", id);
    for (const field of PAYMENT_FIELDS) form.set(field, changes[field] ?? currentValue(payment, field));
    form.set("billing_period_start", payment.billing_period_start ?? "");
    const result = await updateIncomePayment(STATE, form);
    if (result.error) return { ok: false, error: result.error };
    return { ok: true, text: result.ok ?? "Payment updated.", recordId: id };
  },
};
