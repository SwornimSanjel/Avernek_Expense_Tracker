"use server";

import { revalidatePath } from "next/cache";
import { exec, one, transaction } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import { addCalendarDays, addCalendarMonths, isValidDate, legacyServiceType, todayIso } from "@/lib/income";
import type {
  AdsStatus,
  AutomationStatus,
  BillingStream,
  Currency,
  IncomeAccountType,
  IncomeAgreementStatus,
  IncomePaymentFor,
  IncomePaymentMethod,
  OtherIncomeCategory,
  RecurringBillingMode,
  WebsiteStatus,
} from "@/lib/types";

export type IncomeFormState = {
  error: string | null;
  ok: string | null;
  /** Set by addIncomeAgreement so the UI can open the client it just created. */
  agreementId?: string;
};

const AGREEMENT_STATUSES: IncomeAgreementStatus[] = [
  "active",
  "pending",
  "paused",
  "completed",
  "cancelled",
];
const WEBSITE_STATUSES: WebsiteStatus[] = [
  "not_started",
  "in_progress",
  "review",
  "completed",
  "on_hold",
  "cancelled",
];
const PAYMENT_METHODS: IncomePaymentMethod[] = [
  "bank_transfer",
  "cash",
  "cheque",
  "wallet",
  "card",
  "other",
];

async function requireIncomeAdmin() {
  const session = await requireSession();
  assertAppOwner(session);
  return session;
}

function stringValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function checkbox(formData: FormData, name: string) {
  const raw = stringValue(formData, name).toLowerCase();
  return raw === "on" || raw === "true" || raw === "yes" || raw === "1";
}

function optionalDate(formData: FormData, name: string): string | null {
  const value = stringValue(formData, name);
  return isValidDate(value) ? value : null;
}

/** A money field that may be blank. Returns null when blank, undefined when invalid. */
function optionalAmount(formData: FormData, name: string): number | null | undefined {
  const raw = stringValue(formData, name);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

function requiredAmount(formData: FormData, name: string): number | undefined {
  const raw = stringValue(formData, name);
  const value = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

function money(amount: number, currency: Currency) {
  return `${currency} ${amount.toLocaleString("en-NP")}`;
}

function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** True when `period` is exactly N calendar months after the billing anchor. */
function isAnchoredPeriod(anchor: string, period: string, firstBillableIndex: number) {
  const months = monthsBetween(anchor, period);
  if (months < firstBillableIndex || months > 600) return false;
  return addCalendarMonths(anchor, months) === period;
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

function revalidateIncome() {
  revalidatePath("/income");
  revalidatePath("/income/[id]", "page");
  revalidatePath("/clients");
  revalidatePath("/funds");
  revalidatePath("/");
}

// -----------------------------------------------------------------------------
// VAT / TDS on a receipt
// -----------------------------------------------------------------------------

/**
 * `amount` is always the bill amount excluding VAT. VAT is collected on top and
 * TDS is what the client withheld; both are typed amounts so a rate change in
 * the Finance Act never needs a code change.
 */
function parseTax(formData: FormData, amount: number, prefix = "") {
  const vat = optionalAmount(formData, `${prefix}vat_amount`);
  const tds = optionalAmount(formData, `${prefix}tds_amount`);
  if (vat === undefined) return { error: "VAT must be zero or more." } as const;
  if (tds === undefined) return { error: "TDS must be zero or more." } as const;
  if ((tds ?? 0) > amount + (vat ?? 0) + 0.001) {
    return { error: "TDS cannot be more than the amount received." } as const;
  }
  return { vat: vat ?? 0, tds: tds ?? 0 } as const;
}

// -----------------------------------------------------------------------------
// Agreement form parsing
// -----------------------------------------------------------------------------

type AgreementValues = Extract<ReturnType<typeof parseAgreement>, { value: unknown }>["value"];

/**
 * Read one client out of the form. The form only asks for dates that exist in
 * real life — contract signed, work started, Day 1 (launch), website delivered —
 * and the billing columns are written from those:
 *
 *   Day 1        -> recurring_billing_start_date, ads/automation live dates,
 *                   setup_due_date (the setup charge pays for month 1)
 *   delivered    -> website_due_date (a website is paid on delivery)
 */
function parseAgreement(formData: FormData) {
  const clientName = stringValue(formData, "client_name");
  const hasWebsite = checkbox(formData, "has_website");
  const hasAds = checkbox(formData, "has_ads");
  const hasAutomation = checkbox(formData, "has_automation");
  const monthly = hasAds || hasAutomation;
  const agreementDate = stringValue(formData, "agreement_date");
  const workStart = optionalDate(formData, "work_start_date");
  const contractEndDate = optionalDate(formData, "contract_end_date");
  const currency = (stringValue(formData, "currency") || "NPR") as Currency;
  const status = (stringValue(formData, "status") || "active") as IncomeAgreementStatus;
  const defaultAccountId = stringValue(formData, "default_money_account_id") || null;

  if (!clientName) return { error: "Enter the client name." } as const;
  if (!hasWebsite && !monthly) {
    return { error: "Select at least one service: website, ads, or AI automation." } as const;
  }
  if (!isValidDate(agreementDate)) {
    return { error: "Enter the date the contract was signed." } as const;
  }
  if (contractEndDate && contractEndDate < agreementDate) {
    return { error: "The contract end date cannot be before the signing date." } as const;
  }
  if (!(["NPR", "USD"] as string[]).includes(currency)) {
    return { error: "Choose NPR or USD." } as const;
  }
  if (!AGREEMENT_STATUSES.includes(status)) {
    return { error: "Choose a valid client status." } as const;
  }

  // --- ads / AI automation: setup (month 1) + recurring (month 2 onwards) -------
  const setupAmount = monthly ? requiredAmount(formData, "setup_amount") : 0;
  const recurringAmount = monthly ? requiredAmount(formData, "recurring_amount") : 0;
  if (setupAmount == null) return { error: "The setup charge must be zero or more." } as const;
  if (recurringAmount == null) return { error: "The monthly fee must be zero or more." } as const;
  const goLive = monthly ? optionalDate(formData, "go_live_date") : null;

  // --- website: one-off project -----------------------------------------------
  const websiteAmount = hasWebsite ? requiredAmount(formData, "website_amount") : 0;
  if (websiteAmount == null) return { error: "The website price must be zero or more." } as const;
  const websiteStatus = (stringValue(formData, "website_status") || "not_started") as WebsiteStatus;
  if (hasWebsite && !WEBSITE_STATUSES.includes(websiteStatus)) {
    return { error: "Choose a valid website status." } as const;
  }
  const websiteStart = hasWebsite ? optionalDate(formData, "website_start_date") : null;
  const websiteCompleted = hasWebsite ? optionalDate(formData, "website_completed_date") : null;
  if (websiteStart && websiteCompleted && websiteCompleted < websiteStart) {
    return { error: "The website cannot be delivered before it started." } as const;
  }

  const today = todayIso();
  const adsStatus: AdsStatus = goLive
    ? goLive <= today ? "live" : "ready"
    : workStart ? "preparation" : "not_started";
  const automationStatus: AutomationStatus = goLive
    ? goLive <= today ? "live" : "ready"
    : workStart ? "development" : "not_started";

  return {
    value: {
      clientName,
      agreementName: stringValue(formData, "agreement_name") || null,
      contactName: stringValue(formData, "contact_name") || null,
      notes: stringValue(formData, "notes") || null,
      hasWebsite,
      hasAds,
      hasAutomation,
      monthly,
      serviceType: legacyServiceType({ website: hasWebsite, ads: hasAds, automation: hasAutomation }),
      agreementDate,
      workStart,
      contractEndDate,
      currency,
      status,
      defaultAccountId,
      deductsTds: checkbox(formData, "deducts_tds"),
      setupAmount,
      recurringAmount,
      goLive,
      adsStatus,
      automationStatus,
      websiteAmount,
      // A delivered website is a completed website.
      websiteStatus: hasWebsite && websiteCompleted ? "completed" : websiteStatus,
      websiteStart,
      websiteCompleted,
    },
  } as const;
}

function agreementColumns(value: AgreementValues) {
  const columns: Record<string, unknown> = {
    client_name: value.clientName,
    agreement_name: value.agreementName,
    contact_name: value.contactName,
    notes: value.notes,
    service_type: value.serviceType,
    has_website: value.hasWebsite,
    has_ads: value.hasAds,
    has_automation: value.hasAutomation,
    agreement_date: value.agreementDate,
    work_start_date: value.workStart,
    contract_end_date: value.contractEndDate,
    default_money_account_id: value.defaultAccountId,
    deducts_tds: value.deductsTds,
    currency: value.currency,
    status: value.status,
  };
  if (value.monthly) {
    Object.assign(columns, {
      setup_amount: value.setupAmount,
      recurring_amount: value.recurringAmount,
      recurring_billing_mode: "combined",
      recurring_billing_start_date: value.goLive,
      setup_due_date: value.goLive,
    });
  }
  if (value.hasAds) {
    Object.assign(columns, { ads_live_date: value.goLive, ads_status: value.adsStatus });
  }
  if (value.hasAutomation) {
    Object.assign(columns, {
      automation_live_date: value.goLive,
      automation_status: value.automationStatus,
    });
  }
  if (value.hasWebsite) {
    Object.assign(columns, {
      website_amount: value.websiteAmount,
      website_status: value.websiteStatus,
      website_start_date: value.websiteStart,
      website_completed_date: value.websiteCompleted,
      website_due_date: value.websiteCompleted,
    });
  }
  return columns;
}

// -----------------------------------------------------------------------------
// Agreements
// -----------------------------------------------------------------------------

export async function addIncomeAgreement(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const parsed = parseAgreement(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the client details.", ok: null };
  const value = parsed.value;

  // The opening payment is optional. Rs. 0 paid is a perfectly valid new client;
  // money recorded later never requires recreating anything.
  const initialAmount = optionalAmount(formData, "initial_paid_amount") ?? 0;
  const initialFor = (stringValue(formData, "initial_payment_for") ||
    (value.monthly ? "setup" : "website")) as IncomePaymentFor;
  const initialPaidOn = stringValue(formData, "initial_paid_on");
  const initialAccountId = stringValue(formData, "initial_money_account_id");
  const initialMethod = stringValue(formData, "initial_method") as IncomePaymentMethod | "";
  let initialTax = { vat: 0, tds: 0 };

  if (initialAmount > 0) {
    if (!(["setup", "website"] as string[]).includes(initialFor)) {
      return { error: "An opening payment can only be a setup or website payment.", ok: null };
    }
    if (initialFor === "website" && !value.hasWebsite) {
      return { error: "Select the website service before recording a website payment.", ok: null };
    }
    if (initialFor === "setup" && !value.monthly) {
      return { error: "Only ads / AI automation clients have a setup charge.", ok: null };
    }
    const cap = initialFor === "setup" ? value.setupAmount : value.websiteAmount;
    if (initialAmount > cap + 0.001) {
      return {
        error: `The opening payment is more than the agreed ${initialFor === "setup" ? "setup charge" : "website price"} of ${money(cap, value.currency)}.`,
        ok: null,
      };
    }
    if (!isValidDate(initialPaidOn)) {
      return { error: "Enter the date the opening payment was received.", ok: null };
    }
    if (initialMethod && !PAYMENT_METHODS.includes(initialMethod)) {
      return { error: "Choose a valid payment method.", ok: null };
    }
    const tax = parseTax(formData, initialAmount, "initial_");
    if ("error" in tax) return { error: tax.error ?? "Check VAT and TDS.", ok: null };
    initialTax = { vat: tax.vat, tds: tax.tds };
  }

  let account: Awaited<ReturnType<typeof paymentAccount>> | null = null;
  if (initialAmount > 0) {
    try {
      account = await paymentAccount(initialAccountId, value.currency);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Choose the receiving account.",
        ok: null,
      };
    }
  }

  const columns = agreementColumns(value);
  if (!columns.default_money_account_id && account) {
    columns.default_money_account_id = account.id;
  }
  if (!value.monthly) {
    columns.setup_amount = 0;
    columns.recurring_amount = 0;
  }
  columns.setup_covers_first_cycle = true;
  columns.created_by = session.sub;

  const names = Object.keys(columns);
  const placeholders = names.map((_, index) => `$${index + 1}`);

  const agreementId = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.income_agreements (${names.join(", ")})
       values (${placeholders.join(", ")}) returning id`,
      names.map((name) => columns[name])
    );
    const id = inserted.rows[0].id;

    if (initialAmount > 0 && account) {
      await client.query(
        `insert into public.income_payments
           (agreement_id, payment_for, billing_period_start, billing_stream, amount, vat_amount,
            tds_amount, paid_on, received_in, money_account_id, account_name, method, note, recorded_by)
         values ($1,$2,null,null,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          initialFor,
          initialAmount,
          initialTax.vat,
          initialTax.tds,
          initialPaidOn,
          account.receivedIn,
          account.id,
          account.name,
          initialMethod || null,
          "Opening payment recorded with the client",
          session.sub,
        ]
      );
    }
    return id;
  });

  revalidateIncome();
  return { error: null, ok: `${value.clientName} added.`, agreementId };
}

export async function updateIncomeAgreement(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  await requireIncomeAdmin();
  const id = stringValue(formData, "agreement_id");
  if (!id) return { error: "Client not found.", ok: null };
  const parsed = parseAgreement(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the client details.", ok: null };
  const value = parsed.value;

  const current = await one<{
    currency: Currency;
    has_website: boolean;
    has_ads: boolean;
    has_automation: boolean;
    recurring_billing_mode: RecurringBillingMode;
    recurring_billing_start_date: string | null;
  }>(
    `select currency, has_website, has_ads, has_automation, recurring_billing_mode,
            recurring_billing_start_date
       from public.income_agreements where id = $1`,
    [id]
  );
  if (!current) return { error: "Client no longer exists.", ok: null };

  const totals = await one<{
    setup_paid: string;
    website_paid: string;
    recurring_count: string;
    stream_recurring_count: string;
  }>(
    `select coalesce(sum(amount) filter (where payment_for = 'setup'), 0)   as setup_paid,
            coalesce(sum(amount) filter (where payment_for = 'website'), 0) as website_paid,
            count(*) filter (where payment_for = 'recurring')               as recurring_count,
            count(*) filter (where payment_for = 'recurring'
                               and billing_stream in ('ads','automation'))  as stream_recurring_count
       from public.income_payments where agreement_id = $1`,
    [id]
  );
  const setupPaid = Number(totals?.setup_paid ?? 0);
  const websitePaid = Number(totals?.website_paid ?? 0);
  const recurringCount = Number(totals?.recurring_count ?? 0);

  if (current.currency !== value.currency && (setupPaid > 0 || websitePaid > 0 || recurringCount > 0)) {
    return { error: "Currency cannot change after payments have been recorded.", ok: null };
  }
  if (value.monthly && setupPaid > value.setupAmount + 0.001) {
    return {
      error: `The setup charge cannot be lower than the ${money(setupPaid, value.currency)} already received for setup.`,
      ok: null,
    };
  }
  if (value.hasWebsite && websitePaid > value.websiteAmount + 0.001) {
    return {
      error: `The website price cannot be lower than the ${money(websitePaid, value.currency)} already received for the website.`,
      ok: null,
    };
  }
  // Removing a service never deletes its financial history; it is refused while
  // that history exists so nothing silently loses its meaning.
  if (current.has_website && !value.hasWebsite && websitePaid > 0) {
    return {
      error: "This client has website payments recorded. Delete those payments first if the website service really is gone.",
      ok: null,
    };
  }
  if (!value.monthly && (recurringCount > 0 || setupPaid > 0)) {
    return {
      error: "Setup or monthly payments exist for this client. Keep ads or AI automation selected — use “Completed” status when the work ends.",
      ok: null,
    };
  }
  if (
    value.monthly &&
    current.recurring_billing_mode === "separate" &&
    Number(totals?.stream_recurring_count ?? 0) > 0
  ) {
    return {
      error: "This client's old payments were filed per service (ads / automation separately). Delete or re-record those monthly payments before switching to one monthly fee.",
      ok: null,
    };
  }

  // Moving Day 1 rewrites every monthly due date, so it needs an explicit
  // confirmation once monthly payments exist.
  const anchorChanged =
    value.monthly &&
    (current.recurring_billing_start_date ?? null) !== (value.goLive ?? null);
  if (anchorChanged && recurringCount > 0 && !checkbox(formData, "confirm_billing_change")) {
    return {
      error:
        "Changing Day 1 moves every monthly due date. Tick “I understand the monthly due dates will move” to continue.",
      ok: null,
    };
  }

  const columns = agreementColumns(value);
  const names = Object.keys(columns);
  const assignments = names.map((name, index) => `${name} = $${index + 1}`);
  const params = names.map((name) => columns[name]);
  params.push(id);

  const changed = await exec(
    `update public.income_agreements
        set ${assignments.join(", ")}, updated_at = now()
      where id = $${params.length}`,
    params
  );
  if (!changed) return { error: "Client no longer exists.", ok: null };

  revalidateIncome();
  return { error: null, ok: "Client updated." };
}

/**
 * "Launched — Day 1". Sets the go-live date for every monthly service at once:
 * month 1 is covered by the setup charge and the monthly fee starts a calendar
 * month later. Moving an existing Day 1 needs consent once monthly payments
 * depend on it.
 */
export async function markServiceLive(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  await requireIncomeAdmin();
  const id = stringValue(formData, "agreement_id");
  const liveDate = stringValue(formData, "live_date");

  if (!id) return { error: "Client not found.", ok: null };
  if (!isValidDate(liveDate)) return { error: "Pick the day the ads / AI automation went live.", ok: null };
  // One day of slack: the server clock may run behind Nepal time.
  if (liveDate > addCalendarDays(todayIso(), 1)) {
    return {
      error: "Day 1 can't be in the future. Come back and set it on the day the ads actually go live.",
      ok: null,
    };
  }

  const agreement = await one<{
    client_name: string;
    has_ads: boolean;
    has_automation: boolean;
    recurring_billing_mode: RecurringBillingMode;
    recurring_billing_start_date: string | null;
    recurring_count: string;
    stream_recurring_count: string;
  }>(
    `select a.client_name, a.has_ads, a.has_automation, a.recurring_billing_mode,
            a.recurring_billing_start_date,
            (select count(*) from public.income_payments p
              where p.agreement_id = a.id and p.payment_for = 'recurring') as recurring_count,
            (select count(*) from public.income_payments p
              where p.agreement_id = a.id and p.payment_for = 'recurring'
                and p.billing_stream in ('ads','automation')) as stream_recurring_count
       from public.income_agreements a where a.id = $1`,
    [id]
  );
  if (!agreement) return { error: "Client no longer exists.", ok: null };
  if (!agreement.has_ads && !agreement.has_automation) {
    return { error: "This client has no ads or AI automation service.", ok: null };
  }
  if (agreement.recurring_billing_mode === "separate" && Number(agreement.stream_recurring_count) > 0) {
    return {
      error: "This client's monthly payments were filed per service. Edit the client to set Day 1.",
      ok: null,
    };
  }
  if (
    agreement.recurring_billing_start_date &&
    agreement.recurring_billing_start_date !== liveDate &&
    Number(agreement.recurring_count) > 0 &&
    !checkbox(formData, "confirm_billing_change")
  ) {
    return {
      error: "Monthly payments already exist. Tick the confirmation to move Day 1 and its due dates.",
      ok: null,
    };
  }

  const liveStatus = liveDate <= todayIso() ? "live" : "ready";
  await exec(
    `update public.income_agreements
        set recurring_billing_start_date = $1,
            setup_due_date = $1,
            recurring_billing_mode = 'combined',
            ads_live_date = case when has_ads then $1 else ads_live_date end,
            ads_status = case when has_ads then $2 else ads_status end,
            automation_live_date = case when has_automation then $1 else automation_live_date end,
            automation_status = case when has_automation then $2 else automation_status end,
            status = case when status = 'pending' then 'active' else status end,
            updated_at = now()
      where id = $3`,
    [liveDate, liveStatus, id]
  );

  revalidateIncome();
  return { error: null, ok: `${agreement.client_name} launched — Day 1 is ${liveDate}.` };
}

/**
 * "Not launched yet": remove Day 1 again, e.g. when a guessed future date was
 * entered. Refused once monthly payments are filed against it.
 */
export async function clearLaunchDate(agreementId: string) {
  await requireIncomeAdmin();
  const row = await one<{ recurring_count: string }>(
    `select count(*) as recurring_count from public.income_payments
      where agreement_id = $1 and payment_for = 'recurring'`,
    [agreementId]
  );
  if (Number(row?.recurring_count ?? 0) > 0) {
    throw new Error("Monthly payments are already recorded against this Day 1. Change the date instead of clearing it.");
  }
  await exec(
    `update public.income_agreements
        set recurring_billing_start_date = null,
            setup_due_date = null,
            ads_live_date = case when has_ads then null else ads_live_date end,
            automation_live_date = case when has_automation then null else automation_live_date end,
            ads_billing_start_date = null,
            automation_billing_start_date = null,
            ads_status = case when not has_ads then ads_status
                              when work_start_date is not null then 'preparation' else 'not_started' end,
            automation_status = case when not has_automation then automation_status
                              when work_start_date is not null then 'development' else 'not_started' end,
            updated_at = now()
      where id = $1`,
    [agreementId]
  );
  revalidateIncome();
}

export async function setIncomeAgreementStatus(id: string, status: IncomeAgreementStatus) {
  await requireIncomeAdmin();
  if (!AGREEMENT_STATUSES.includes(status)) {
    throw new Error("Invalid agreement status.");
  }
  // service_end_date closes the recurring schedule; it is only set when work
  // actually ends, and cleared when the client becomes active again.
  const endsService = status === "completed" || status === "cancelled";
  await exec(
    `update public.income_agreements
        set status = $1,
            service_end_date = case
              when $2::boolean then coalesce(service_end_date, current_date)
              else null
            end,
            updated_at = now()
      where id = $3`,
    [status, endsService, id]
  );
  revalidateIncome();
}

export async function deleteIncomeAgreement(id: string) {
  await requireIncomeAdmin();
  const agreement = await one<{ client_name: string }>(
    `select client_name from public.income_agreements where id = $1`,
    [id]
  );
  if (!agreement) return;

  // income_payments is intentionally ON DELETE CASCADE. Removing a client
  // agreement therefore removes its receipts from the account ledger too.
  await exec(`delete from public.income_agreements where id = $1`, [id]);
  revalidateIncome();
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

type PaymentTarget = {
  agreementId: string;
  paymentFor: IncomePaymentFor;
  period: string | null;
  stream: BillingStream | null;
  agreed: number;
  currency: Currency;
  clientName: string;
};

/**
 * Resolve what a payment is being made against and how much is still owed on
 * it. `excludePaymentId` lets an edit measure the room around itself.
 */
async function resolvePaymentTarget(
  agreementId: string,
  paymentFor: IncomePaymentFor,
  periodInput: string,
  streamInput: string,
  /**
   * Set when correcting a payment that already exists. A recorded receipt keeps
   * its meaning even if the client's billing was reconfigured afterwards, so an
   * old cycle payment stays editable instead of becoming untouchable.
   */
  existing?: { period: string | null; stream: BillingStream | null }
): Promise<{ error: string } | { target: PaymentTarget }> {
  const agreement = await one<{
    client_name: string;
    currency: Currency;
    has_website: boolean;
    has_ads: boolean;
    has_automation: boolean;
    setup_amount: string;
    website_amount: string;
    recurring_amount: string;
    ads_monthly_amount: string | null;
    automation_monthly_amount: string | null;
    recurring_billing_mode: RecurringBillingMode;
    recurring_billing_start_date: string | null;
    ads_billing_start_date: string | null;
    automation_billing_start_date: string | null;
    setup_covers_first_cycle: boolean;
  }>(
    `select client_name, currency, has_website, has_ads, has_automation,
            setup_amount, website_amount, recurring_amount,
            ads_monthly_amount, automation_monthly_amount,
            recurring_billing_mode, recurring_billing_start_date,
            ads_billing_start_date, automation_billing_start_date,
            setup_covers_first_cycle
       from public.income_agreements where id = $1`,
    [agreementId]
  );
  if (!agreement) return { error: "Agreement no longer exists." };

  const base = {
    agreementId,
    currency: agreement.currency,
    clientName: agreement.client_name,
  };

  if (paymentFor === "setup") {
    return {
      target: {
        ...base,
        paymentFor,
        period: null,
        stream: null,
        agreed: Number(agreement.setup_amount),
      },
    };
  }

  if (paymentFor === "website") {
    if (!agreement.has_website) {
      return { error: "This client does not have the website service." };
    }
    return {
      target: {
        ...base,
        paymentFor,
        period: null,
        stream: null,
        agreed: Number(agreement.website_amount),
      },
    };
  }

  const separate = agreement.recurring_billing_mode === "separate";
  const stream = (streamInput || (separate ? "" : "combined")) as BillingStream;
  const monthlyFor = (key: BillingStream) =>
    key === "ads"
      ? Number(agreement.ads_monthly_amount ?? agreement.recurring_amount)
      : key === "automation"
        ? Number(agreement.automation_monthly_amount ?? agreement.recurring_amount)
        : Number(agreement.recurring_amount);

  const streamIsBilled = separate
    ? (stream === "ads" && agreement.has_ads) ||
      (stream === "automation" && agreement.has_automation)
    : stream === "combined";

  if (!streamIsBilled) {
    // An existing receipt recorded against a stream this client no longer bills
    // stays correctable; only the cap against the current fee is dropped.
    if (existing) {
      return {
        target: {
          ...base,
          paymentFor,
          period: existing.period,
          stream: existing.stream,
          agreed: Number.MAX_SAFE_INTEGER,
        },
      };
    }
    if (!separate) return { error: "This client is billed with one combined monthly fee." };
    if (!(["ads", "automation"] as string[]).includes(stream)) {
      return { error: "Choose whether this payment covers ads or AI automation." };
    }
    return {
      error:
        stream === "ads"
          ? "This client does not have the ads service."
          : "This client does not have the AI automation service.",
    };
  }

  const anchor = separate
    ? stream === "ads"
      ? agreement.ads_billing_start_date ?? agreement.recurring_billing_start_date
      : agreement.automation_billing_start_date ?? agreement.recurring_billing_start_date
    : agreement.recurring_billing_start_date;
  if (!isValidDate(anchor)) {
    return {
      error:
        "Recurring billing has not started yet. Set the recurring billing start date (or mark the service live) before recording a monthly payment.",
    };
  }
  if (!isValidDate(periodInput)) {
    return { error: "Choose which monthly service period this payment covers." };
  }
  const firstIndex = agreement.setup_covers_first_cycle ? 1 : 0;
  if (!isAnchoredPeriod(anchor, periodInput, firstIndex)) {
    // A period that no longer sits on the anchor can still be corrected; it just
    // keeps the cycle it was filed against.
    if (existing?.period) {
      return {
        target: {
          ...base,
          paymentFor,
          period: existing.period,
          stream: existing.stream ?? stream,
          agreed: monthlyFor(stream),
        },
      };
    }
    return { error: "That billing period is not a monthly cycle from the recurring billing start date." };
  }

  return {
    target: { ...base, paymentFor, period: periodInput, stream, agreed: monthlyFor(stream) },
  };
}

async function alreadyPaid(target: PaymentTarget, excludePaymentId?: string) {
  const conditions = ["agreement_id = $1", "payment_for = $2"];
  const params: unknown[] = [target.agreementId, target.paymentFor];
  if (target.paymentFor === "recurring") {
    params.push(target.period);
    conditions.push(`billing_period_start = $${params.length}`);
    params.push(target.stream);
    conditions.push(`coalesce(billing_stream, 'combined') = $${params.length}`);
  }
  if (excludePaymentId) {
    params.push(excludePaymentId);
    conditions.push(`id <> $${params.length}`);
  }
  const row = await one<{ paid: string }>(
    `select coalesce(sum(amount), 0) as paid from public.income_payments
      where ${conditions.join(" and ")}`,
    params
  );
  return Number(row?.paid ?? 0);
}

export async function recordIncomePayment(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const agreementId = stringValue(formData, "agreement_id");
  const paymentFor = stringValue(formData, "payment_for") as IncomePaymentFor;
  const amount = Number(formData.get("amount"));
  const paidOn = stringValue(formData, "paid_on");
  const moneyAccountId = stringValue(formData, "money_account_id");
  const method = stringValue(formData, "method") as IncomePaymentMethod | "";
  const reference = stringValue(formData, "reference") || null;
  const note = stringValue(formData, "note") || null;

  if (!agreementId) return { error: "Agreement not found.", ok: null };
  if (!(["setup", "recurring", "website"] as string[]).includes(paymentFor)) {
    return { error: "Choose what this payment is for.", ok: null };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "The payment amount must be greater than zero.", ok: null };
  }
  if (!isValidDate(paidOn)) return { error: "Enter the date the payment was received.", ok: null };
  if (method && !PAYMENT_METHODS.includes(method)) {
    return { error: "Choose a valid payment method.", ok: null };
  }

  const resolved = await resolvePaymentTarget(
    agreementId,
    paymentFor,
    stringValue(formData, "billing_period_start"),
    stringValue(formData, "billing_stream")
  );
  if ("error" in resolved) return { error: resolved.error, ok: null };
  const target = resolved.target;

  let account: Awaited<ReturnType<typeof paymentAccount>>;
  try {
    account = await paymentAccount(moneyAccountId, target.currency);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Choose the receiving account.",
      ok: null,
    };
  }

  const tax = parseTax(formData, amount);
  if ("error" in tax) return { error: tax.error ?? "Check VAT and TDS.", ok: null };

  const paid = await alreadyPaid(target);
  const remaining = Math.max(0, target.agreed - paid);
  if (amount > remaining + 0.001) {
    return {
      error: `Only ${money(remaining, target.currency)} is still outstanding on this ${
        target.paymentFor === "recurring" ? "month" : target.paymentFor === "setup" ? "setup charge" : "website"
      } (excluding VAT). Record the rest against the month or balance it actually pays.`,
      ok: null,
    };
  }

  await exec(
    `insert into public.income_payments
       (agreement_id, payment_for, billing_period_start, billing_stream, amount, vat_amount,
        tds_amount, paid_on, received_in, money_account_id, account_name, method, reference,
        note, recorded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      agreementId,
      paymentFor,
      target.period,
      target.stream,
      amount,
      tax.vat,
      tax.tds,
      paidOn,
      account.receivedIn,
      account.id,
      account.name,
      method || null,
      reference,
      note,
      session.sub,
    ]
  );

  revalidateIncome();
  return { error: null, ok: `Payment recorded for ${target.clientName}.` };
}

export async function updateIncomePayment(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const paymentId = stringValue(formData, "payment_id");
  const amount = Number(formData.get("amount"));
  const paidOn = stringValue(formData, "paid_on");
  const moneyAccountId = stringValue(formData, "money_account_id");
  const method = stringValue(formData, "method") as IncomePaymentMethod | "";
  const reference = stringValue(formData, "reference") || null;
  const note = stringValue(formData, "note") || null;

  if (!paymentId) return { error: "Payment not found.", ok: null };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "The payment amount must be greater than zero.", ok: null };
  }
  if (!isValidDate(paidOn)) return { error: "Enter the date the payment was received.", ok: null };
  if (method && !PAYMENT_METHODS.includes(method)) {
    return { error: "Choose a valid payment method.", ok: null };
  }

  const payment = await one<{
    agreement_id: string;
    payment_for: IncomePaymentFor;
    billing_period_start: string | null;
    billing_stream: BillingStream | null;
  }>(
    `select agreement_id, payment_for, billing_period_start, billing_stream
       from public.income_payments where id = $1`,
    [paymentId]
  );
  if (!payment) return { error: "Payment no longer exists.", ok: null };

  // A recurring payment may be moved to a different cycle when it was filed
  // against the wrong month; everything else keeps its original meaning.
  const periodInput =
    payment.payment_for === "recurring"
      ? stringValue(formData, "billing_period_start") || (payment.billing_period_start ?? "")
      : "";
  const resolved = await resolvePaymentTarget(
    payment.agreement_id,
    payment.payment_for,
    periodInput,
    payment.billing_stream ?? "",
    { period: payment.billing_period_start, stream: payment.billing_stream }
  );
  if ("error" in resolved) return { error: resolved.error, ok: null };
  const target = resolved.target;

  let account: Awaited<ReturnType<typeof paymentAccount>>;
  try {
    account = await paymentAccount(moneyAccountId, target.currency);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Choose the receiving account.",
      ok: null,
    };
  }

  const tax = parseTax(formData, amount);
  if ("error" in tax) return { error: tax.error ?? "Check VAT and TDS.", ok: null };

  const paidByOthers = await alreadyPaid(target, paymentId);
  const available = Math.max(0, target.agreed - paidByOthers);
  if (amount > available + 0.001) {
    return {
      error: `Only ${money(available, target.currency)} (excluding VAT) of this balance is unpaid by other records.`,
      ok: null,
    };
  }

  const changed = await exec(
    `update public.income_payments
        set amount = $1, paid_on = $2, received_in = $3, money_account_id = $4,
            account_name = $5, method = $6, reference = $7, note = $8,
            billing_period_start = $9, updated_by = $10, vat_amount = $12, tds_amount = $13,
            updated_at = now()
      where id = $11`,
    [
      amount,
      paidOn,
      account.receivedIn,
      account.id,
      account.name,
      method || null,
      reference,
      note,
      target.period,
      session.sub,
      paymentId,
      tax.vat,
      tax.tds,
    ]
  );
  if (!changed) return { error: "Payment no longer exists.", ok: null };

  revalidateIncome();
  return { error: null, ok: "Payment updated." };
}

export async function deleteIncomePayment(id: string) {
  await requireIncomeAdmin();
  // Deleting a receipt restores the outstanding balance automatically: every
  // total is summed from the remaining payment rows.
  await exec(`delete from public.income_payments where id = $1`, [id]);
  revalidateIncome();
}

// -----------------------------------------------------------------------------
// Income without a client agreement
//
// One-off website jobs for people who never signed an agreement, extra work,
// consulting. It is revenue (unlike capital) but has no billing schedule, so it
// lives in its own ledger instead of forcing a fake client.
// -----------------------------------------------------------------------------

const OTHER_INCOME_CATEGORIES: OtherIncomeCategory[] = [
  "website_project",
  "extra_work",
  "consulting",
  "commission",
  "other",
];

async function parseOtherIncome(formData: FormData) {
  const accountId = stringValue(formData, "money_account_id");
  const category = (stringValue(formData, "category") || "other") as OtherIncomeCategory;
  const description = stringValue(formData, "description");
  const amount = Number(formData.get("amount"));
  const receivedOn = stringValue(formData, "received_on");
  const method = stringValue(formData, "method") as IncomePaymentMethod | "";

  if (!description) return { error: "Describe what this income was for." } as const;
  if (!OTHER_INCOME_CATEGORIES.includes(category)) return { error: "Choose a valid income type." } as const;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "The amount (excluding VAT) must be greater than zero." } as const;
  }
  if (!isValidDate(receivedOn)) return { error: "Enter the date the money was received." } as const;
  if (method && !PAYMENT_METHODS.includes(method)) return { error: "Choose a valid payment method." } as const;
  const tax = parseTax(formData, amount);
  if ("error" in tax) return { error: tax.error ?? "Check VAT and TDS." } as const;

  const account = await one<{ is_active: boolean }>(
    `select is_active from public.money_accounts where id = $1`,
    [accountId || null]
  );
  if (!account?.is_active) return { error: "Choose the account that received the money." } as const;

  return {
    value: {
      accountId,
      category,
      sourceName: stringValue(formData, "source_name") || null,
      description,
      amount: Math.round(amount * 100) / 100,
      vat: tax.vat,
      tds: tax.tds,
      receivedOn,
      method: method || null,
      reference: stringValue(formData, "reference") || null,
      note: stringValue(formData, "note") || null,
    },
  } as const;
}

export async function addOtherIncome(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const parsed = await parseOtherIncome(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the income details.", ok: null };
  const v = parsed.value;
  await exec(
    `insert into public.other_income
       (money_account_id, category, source_name, description, amount, vat_amount, tds_amount,
        received_on, method, reference, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [v.accountId, v.category, v.sourceName, v.description, v.amount, v.vat, v.tds,
     v.receivedOn, v.method, v.reference, v.note, session.sub]
  );
  revalidateIncome();
  return { error: null, ok: "Income recorded." };
}

export async function updateOtherIncome(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  const session = await requireIncomeAdmin();
  const id = stringValue(formData, "income_id");
  if (!id) return { error: "That income record was not found.", ok: null };
  const parsed = await parseOtherIncome(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the income details.", ok: null };
  const v = parsed.value;
  const changed = await exec(
    `update public.other_income
        set money_account_id = $1, category = $2, source_name = $3, description = $4,
            amount = $5, vat_amount = $6, tds_amount = $7, received_on = $8, method = $9,
            reference = $10, note = $11, updated_by = $12, updated_at = now()
      where id = $13`,
    [v.accountId, v.category, v.sourceName, v.description, v.amount, v.vat, v.tds,
     v.receivedOn, v.method, v.reference, v.note, session.sub, id]
  );
  if (!changed) return { error: "That income record no longer exists.", ok: null };
  revalidateIncome();
  return { error: null, ok: "Income updated." };
}

export async function deleteOtherIncome(id: string) {
  await requireIncomeAdmin();
  await exec(`delete from public.other_income where id = $1`, [id]);
  revalidateIncome();
}
