"use server";

import { revalidatePath } from "next/cache";
import { exec, one, transaction } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import { addCalendarMonths, isValidDate, legacyServiceType } from "@/lib/income";
import type {
  AdsStatus,
  AutomationStatus,
  BillingStream,
  Currency,
  IncomeAccountType,
  IncomeAgreementStatus,
  IncomePaymentFor,
  IncomePaymentMethod,
  RecurringBillingMode,
  SetupPaymentTerms,
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
const ADS_STATUSES: AdsStatus[] = [
  "not_started",
  "preparation",
  "ready",
  "live",
  "paused",
  "stopped",
];
const AUTOMATION_STATUSES: AutomationStatus[] = [
  "not_started",
  "development",
  "testing",
  "ready",
  "live",
  "paused",
  "stopped",
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
// Agreement form parsing
// -----------------------------------------------------------------------------

type AgreementValues = Extract<ReturnType<typeof parseAgreement>, { value: unknown }>["value"];

/**
 * Read one agreement out of the form. Only fields that belong to a selected
 * service are validated, so a website-only client is never asked for a
 * recurring amount or a live date.
 */
function parseAgreement(formData: FormData) {
  const clientName = stringValue(formData, "client_name");
  const hasWebsite = checkbox(formData, "has_website");
  const hasAds = checkbox(formData, "has_ads");
  const hasAutomation = checkbox(formData, "has_automation");
  const agreementDate = stringValue(formData, "agreement_date");
  const contractEndDate = optionalDate(formData, "contract_end_date");
  const currency = stringValue(formData, "currency") as Currency;
  const status = stringValue(formData, "status") as IncomeAgreementStatus;
  const defaultAccountId = stringValue(formData, "default_money_account_id") || null;

  if (!clientName) return { error: "Enter the client name." } as const;
  if (!hasWebsite && !hasAds && !hasAutomation) {
    return { error: "Select at least one service: website, ads, or AI automation." } as const;
  }
  if (!isValidDate(agreementDate)) {
    return { error: "Enter a valid agreement start date." } as const;
  }
  if (contractEndDate && contractEndDate < agreementDate) {
    return { error: "The contract end date cannot be before the agreement start date." } as const;
  }
  if (!(["NPR", "USD"] as string[]).includes(currency)) {
    return { error: "Choose NPR or USD." } as const;
  }
  if (!AGREEMENT_STATUSES.includes(status)) {
    return { error: "Choose a valid agreement status." } as const;
  }

  // --- setup / initial billing -------------------------------------------------
  const setupAmount = requiredAmount(formData, "setup_amount");
  const setupDueDate = stringValue(formData, "setup_due_date");
  const terms = stringValue(formData, "setup_payment_terms") as SetupPaymentTerms;
  const advancePercent = Number(formData.get("setup_advance_percent") ?? 100);
  const setupPaidInFull = optionalDate(formData, "setup_paid_in_full_date");

  if (setupAmount == null) return { error: "The setup amount must be zero or more." } as const;
  if (!isValidDate(setupDueDate)) {
    return { error: "Enter the initial / setup payment due date." } as const;
  }
  if (!(["full_upfront", "half_advance", "custom"] as string[]).includes(terms)) {
    return { error: "Choose valid setup payment terms." } as const;
  }
  if (!Number.isFinite(advancePercent) || advancePercent < 0 || advancePercent > 100) {
    return { error: "Advance percentage must be between 0 and 100." } as const;
  }

  // --- website ------------------------------------------------------------------
  const websiteAmount = hasWebsite ? requiredAmount(formData, "website_amount") : 0;
  const websiteStatus = (stringValue(formData, "website_status") || "not_started") as WebsiteStatus;
  if (websiteAmount == null) return { error: "The website price must be zero or more." } as const;
  if (hasWebsite && !WEBSITE_STATUSES.includes(websiteStatus)) {
    return { error: "Choose a valid website status." } as const;
  }
  const websiteStart = hasWebsite ? optionalDate(formData, "website_start_date") : null;
  const websiteExpected = hasWebsite ? optionalDate(formData, "website_expected_date") : null;
  const websiteCompleted = hasWebsite ? optionalDate(formData, "website_completed_date") : null;
  const websiteDue = hasWebsite ? optionalDate(formData, "website_due_date") : null;
  const websitePaidInFull = hasWebsite ? optionalDate(formData, "website_paid_in_full_date") : null;
  const websiteNotes = hasWebsite ? stringValue(formData, "website_notes") || null : null;

  // --- ads ----------------------------------------------------------------------
  const adsStatus = (stringValue(formData, "ads_status") || "not_started") as AdsStatus;
  if (hasAds && !ADS_STATUSES.includes(adsStatus)) {
    return { error: "Choose a valid ads status." } as const;
  }
  const adsPrepStart = hasAds ? optionalDate(formData, "ads_prep_start_date") : null;
  const adsLiveDate = hasAds ? optionalDate(formData, "ads_live_date") : null;
  const adsNotes = hasAds ? stringValue(formData, "ads_notes") || null : null;

  // --- automation ----------------------------------------------------------------
  const automationStatus = (stringValue(formData, "automation_status") ||
    "not_started") as AutomationStatus;
  if (hasAutomation && !AUTOMATION_STATUSES.includes(automationStatus)) {
    return { error: "Choose a valid AI automation status." } as const;
  }
  const automationLiveDate = hasAutomation ? optionalDate(formData, "automation_live_date") : null;
  const automationNotes = hasAutomation ? stringValue(formData, "automation_notes") || null : null;

  // --- recurring ------------------------------------------------------------------
  const recurringService = hasAds || hasAutomation;
  const mode = ((stringValue(formData, "recurring_billing_mode") ||
    "combined") as RecurringBillingMode);
  if (!(["combined", "separate"] as string[]).includes(mode)) {
    return { error: "Choose combined or separate monthly billing." } as const;
  }
  const recurringAmount = recurringService && mode === "combined"
    ? requiredAmount(formData, "recurring_amount")
    : 0;
  if (recurringAmount == null) {
    return { error: "The monthly recurring amount must be zero or more." } as const;
  }
  const adsMonthly = recurringService && mode === "separate" && hasAds
    ? optionalAmount(formData, "ads_monthly_amount")
    : null;
  const automationMonthly = recurringService && mode === "separate" && hasAutomation
    ? optionalAmount(formData, "automation_monthly_amount")
    : null;
  if (adsMonthly === undefined || automationMonthly === undefined) {
    return { error: "Monthly service amounts must be zero or more." } as const;
  }
  const billingStart = recurringService
    ? optionalDate(formData, "recurring_billing_start_date")
    : null;
  const adsBillingStart = recurringService && mode === "separate"
    ? optionalDate(formData, "ads_billing_start_date")
    : null;
  const automationBillingStart = recurringService && mode === "separate"
    ? optionalDate(formData, "automation_billing_start_date")
    : null;
  const setupCoversFirstCycle = recurringService
    ? checkbox(formData, "setup_covers_first_cycle")
    : true;
  const dueDays = Number(formData.get("recurring_due_days_before") ?? 0);
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 30) {
    return { error: "Recurring due days must be between 0 and 30." } as const;
  }

  return {
    value: {
      clientName,
      agreementName: stringValue(formData, "agreement_name") || null,
      contactName: stringValue(formData, "contact_name") || null,
      hasWebsite,
      hasAds,
      hasAutomation,
      serviceType: legacyServiceType({
        website: hasWebsite,
        ads: hasAds,
        automation: hasAutomation,
      }),
      agreementDate,
      contractEndDate,
      currency,
      status,
      defaultAccountId,
      setupAmount,
      setupDueDate,
      terms,
      advancePercent: terms === "half_advance" ? advancePercent : 100,
      setupPaidInFull,
      setupNotes: stringValue(formData, "setup_notes") || null,
      websiteAmount,
      websiteStatus: hasWebsite ? websiteStatus : "not_started",
      websiteStart,
      websiteExpected,
      websiteCompleted,
      websiteDue,
      websitePaidInFull,
      websiteNotes,
      adsStatus: hasAds ? adsStatus : "not_started",
      adsPrepStart,
      adsLiveDate,
      adsNotes,
      automationStatus: hasAutomation ? automationStatus : "not_started",
      automationLiveDate,
      automationNotes,
      mode: recurringService ? mode : "combined",
      recurringAmount,
      adsMonthly,
      automationMonthly,
      billingStart,
      adsBillingStart,
      automationBillingStart,
      setupCoversFirstCycle,
      dueDays,
      notes: stringValue(formData, "notes") || null,
    },
  } as const;
}

/**
 * Columns that belong to one service. When a service is switched off its stored
 * dates, prices and statuses are LEFT ALONE rather than nulled: the day ads
 * really went live stays true whether or not the client still buys ads, and
 * turning the service back on restores what was already known.
 */
const SERVICE_COLUMNS = {
  website: [
    "website_amount",
    "website_status",
    "website_start_date",
    "website_expected_date",
    "website_completed_date",
    "website_due_date",
    "website_paid_in_full_date",
    "website_notes",
  ],
  ads: ["ads_status", "ads_prep_start_date", "ads_live_date", "ads_notes"],
  automation: ["automation_status", "automation_live_date", "automation_notes"],
  // Per-service amounts only apply in 'separate' mode; in combined mode they
  // are kept as they were instead of being wiped on every save.
  separateBilling: [
    "ads_monthly_amount",
    "ads_billing_start_date",
    "automation_monthly_amount",
    "automation_billing_start_date",
  ],
} as const;

function agreementColumns(value: AgreementValues) {
  return {
    client_name: value.clientName,
    agreement_name: value.agreementName,
    service_type: value.serviceType,
    has_website: value.hasWebsite,
    has_ads: value.hasAds,
    has_automation: value.hasAutomation,
    contact_name: value.contactName,
    agreement_date: value.agreementDate,
    contract_end_date: value.contractEndDate,
    default_money_account_id: value.defaultAccountId,
    currency: value.currency,
    setup_amount: value.setupAmount,
    setup_payment_terms: value.terms,
    setup_advance_percent: value.advancePercent,
    setup_due_date: value.setupDueDate,
    setup_paid_in_full_date: value.setupPaidInFull,
    setup_notes: value.setupNotes,
    website_amount: value.websiteAmount,
    website_status: value.websiteStatus,
    website_start_date: value.websiteStart,
    website_expected_date: value.websiteExpected,
    website_completed_date: value.websiteCompleted,
    website_due_date: value.websiteDue,
    website_paid_in_full_date: value.websitePaidInFull,
    website_notes: value.websiteNotes,
    ads_status: value.adsStatus,
    ads_prep_start_date: value.adsPrepStart,
    ads_live_date: value.adsLiveDate,
    ads_monthly_amount: value.adsMonthly,
    ads_billing_start_date: value.adsBillingStart,
    ads_notes: value.adsNotes,
    automation_status: value.automationStatus,
    automation_live_date: value.automationLiveDate,
    automation_monthly_amount: value.automationMonthly,
    automation_billing_start_date: value.automationBillingStart,
    automation_notes: value.automationNotes,
    recurring_billing_mode: value.mode,
    recurring_amount: value.recurringAmount,
    recurring_billing_start_date: value.billingStart,
    setup_covers_first_cycle: value.setupCoversFirstCycle,
    recurring_due_days_before: value.dueDays,
    status: value.status,
  } as Record<string, unknown>;
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
  if ("error" in parsed) return { error: parsed.error ?? "Check the agreement details.", ok: null };
  const value = parsed.value;

  // The opening payment is optional. Rs. 0 paid is a perfectly valid new client;
  // money recorded later never requires recreating anything.
  const initialAmount = optionalAmount(formData, "initial_paid_amount") ?? 0;
  const initialFor = (stringValue(formData, "initial_payment_for") || "setup") as IncomePaymentFor;
  const initialPaidOn = stringValue(formData, "initial_paid_on");
  const initialAccountId = stringValue(formData, "initial_money_account_id");
  const initialMethod = stringValue(formData, "initial_method") as IncomePaymentMethod | "";

  if (initialAmount > 0) {
    if (!(["setup", "website"] as string[]).includes(initialFor)) {
      return { error: "An opening payment can only be a setup or website payment.", ok: null };
    }
    if (initialFor === "website" && !value.hasWebsite) {
      return { error: "Select the website service before recording a website payment.", ok: null };
    }
    const cap = initialFor === "setup" ? value.setupAmount : value.websiteAmount;
    if (initialAmount > cap + 0.001) {
      return {
        error: `The opening payment is more than the agreed ${initialFor === "setup" ? "setup" : "website"} amount of ${money(cap, value.currency)}.`,
        ok: null,
      };
    }
    if (!isValidDate(initialPaidOn)) {
      return { error: "Enter the date the opening payment was received.", ok: null };
    }
    if (initialMethod && !PAYMENT_METHODS.includes(initialMethod)) {
      return { error: "Choose a valid payment method.", ok: null };
    }
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
  // A brand-new client keeps its chosen receiving account even before any money
  // arrives, so the VAT / non-VAT classification is never guessed later.
  if (!columns.default_money_account_id && account) {
    columns.default_money_account_id = account.id;
  }
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
           (agreement_id, payment_for, billing_period_start, billing_stream, amount,
            paid_on, received_in, money_account_id, account_name, method, note, recorded_by)
         values ($1,$2,null,null,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          initialFor,
          initialAmount,
          initialPaidOn,
          account.receivedIn,
          account.id,
          account.name,
          initialMethod || null,
          "Opening payment recorded with the agreement",
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
  if (!id) return { error: "Agreement not found.", ok: null };
  const parsed = parseAgreement(formData);
  if ("error" in parsed) return { error: parsed.error ?? "Check the agreement details.", ok: null };
  const value = parsed.value;

  const current = await one<{
    currency: Currency;
    has_website: boolean;
    has_ads: boolean;
    has_automation: boolean;
    recurring_billing_mode: RecurringBillingMode;
    recurring_billing_start_date: string | null;
    ads_billing_start_date: string | null;
    automation_billing_start_date: string | null;
  }>(
    `select currency, has_website, has_ads, has_automation, recurring_billing_mode,
            recurring_billing_start_date, ads_billing_start_date, automation_billing_start_date
       from public.income_agreements where id = $1`,
    [id]
  );
  if (!current) return { error: "Agreement no longer exists.", ok: null };

  const totals = await one<{
    setup_paid: string;
    website_paid: string;
    recurring_count: string;
    ads_recurring_count: string;
    automation_recurring_count: string;
  }>(
    `select coalesce(sum(amount) filter (where payment_for = 'setup'), 0)   as setup_paid,
            coalesce(sum(amount) filter (where payment_for = 'website'), 0) as website_paid,
            count(*) filter (where payment_for = 'recurring')               as recurring_count,
            count(*) filter (where payment_for = 'recurring' and billing_stream = 'ads')        as ads_recurring_count,
            count(*) filter (where payment_for = 'recurring' and billing_stream = 'automation') as automation_recurring_count
       from public.income_payments where agreement_id = $1`,
    [id]
  );
  const setupPaid = Number(totals?.setup_paid ?? 0);
  const websitePaid = Number(totals?.website_paid ?? 0);
  const recurringCount = Number(totals?.recurring_count ?? 0);

  if (current.currency !== value.currency && (setupPaid > 0 || websitePaid > 0 || recurringCount > 0)) {
    return { error: "Currency cannot change after payments have been recorded.", ok: null };
  }
  if (setupPaid > value.setupAmount + 0.001) {
    return {
      error: `The setup amount cannot be lower than the ${money(setupPaid, value.currency)} already received for setup.`,
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
  if (current.has_ads && !value.hasAds && Number(totals?.ads_recurring_count ?? 0) > 0) {
    return {
      error: "Ads recurring payments exist for this client. Pause or stop the ads service instead of removing it.",
      ok: null,
    };
  }
  if (
    current.has_automation &&
    !value.hasAutomation &&
    Number(totals?.automation_recurring_count ?? 0) > 0
  ) {
    return {
      error: "AI automation recurring payments exist for this client. Pause or stop the automation service instead of removing it.",
      ok: null,
    };
  }
  if (!value.hasAds && !value.hasAutomation && recurringCount > 0) {
    return {
      error: "Recurring payments exist for this client. Keep at least one recurring service, or delete those payments first.",
      ok: null,
    };
  }

  // Moving a billing anchor rewrites every future due date, so it needs an
  // explicit confirmation once cycle payments exist.
  const anchorChanged =
    (current.recurring_billing_start_date ?? null) !== (value.billingStart ?? null) ||
    (current.ads_billing_start_date ?? null) !== (value.adsBillingStart ?? null) ||
    (current.automation_billing_start_date ?? null) !== (value.automationBillingStart ?? null) ||
    current.recurring_billing_mode !== value.mode;
  if (anchorChanged && recurringCount > 0 && !checkbox(formData, "confirm_billing_change")) {
    return {
      error:
        "This change moves the recurring billing anchor and recalculates every future due date. Tick “I understand this recalculates billing” to continue.",
      ok: null,
    };
  }

  const columns = agreementColumns(value);
  // Leave a switched-off service's own columns exactly as they are.
  const untouched = [
    ...(value.hasWebsite ? [] : SERVICE_COLUMNS.website),
    ...(value.hasAds ? [] : SERVICE_COLUMNS.ads),
    ...(value.hasAutomation ? [] : SERVICE_COLUMNS.automation),
    ...(value.mode === "separate" ? [] : SERVICE_COLUMNS.separateBilling),
  ];
  for (const column of untouched) delete columns[column];

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
  if (!changed) return { error: "Agreement no longer exists.", ok: null };

  revalidateIncome();
  return { error: null, ok: "Client updated." };
}

/**
 * Mark ads or AI automation live. When no recurring anchor exists yet the live
 * date is offered as the anchor (the admin can change or decline it); when
 * billing history already exists the anchor is only moved on explicit consent.
 */
export async function markServiceLive(
  _previous: IncomeFormState,
  formData: FormData
): Promise<IncomeFormState> {
  await requireIncomeAdmin();
  const id = stringValue(formData, "agreement_id");
  const service = stringValue(formData, "service");
  const liveDate = stringValue(formData, "live_date");
  const useAsBillingStart = checkbox(formData, "use_as_billing_start");
  const billingStartOverride = optionalDate(formData, "billing_start_date");

  if (!id) return { error: "Agreement not found.", ok: null };
  if (!(["ads", "automation"] as string[]).includes(service)) {
    return { error: "Choose ads or AI automation.", ok: null };
  }
  if (!isValidDate(liveDate)) return { error: "Enter the date the service went live.", ok: null };

  const agreement = await one<{
    client_name: string;
    has_ads: boolean;
    has_automation: boolean;
    recurring_billing_mode: RecurringBillingMode;
    recurring_billing_start_date: string | null;
    ads_billing_start_date: string | null;
    automation_billing_start_date: string | null;
    recurring_count: string;
  }>(
    `select a.client_name, a.has_ads, a.has_automation, a.recurring_billing_mode,
            a.recurring_billing_start_date, a.ads_billing_start_date,
            a.automation_billing_start_date,
            (select count(*) from public.income_payments p
              where p.agreement_id = a.id and p.payment_for = 'recurring') as recurring_count
       from public.income_agreements a where a.id = $1`,
    [id]
  );
  if (!agreement) return { error: "Agreement no longer exists.", ok: null };
  if (service === "ads" && !agreement.has_ads) {
    return { error: "This client does not have the ads service.", ok: null };
  }
  if (service === "automation" && !agreement.has_automation) {
    return { error: "This client does not have the AI automation service.", ok: null };
  }

  const separate = agreement.recurring_billing_mode === "separate";
  const anchorColumn = separate
    ? service === "ads"
      ? "ads_billing_start_date"
      : "automation_billing_start_date"
    : "recurring_billing_start_date";
  const existingAnchor = separate
    ? service === "ads"
      ? agreement.ads_billing_start_date
      : agreement.automation_billing_start_date
    : agreement.recurring_billing_start_date;

  const nextAnchor = useAsBillingStart
    ? billingStartOverride ?? liveDate
    : existingAnchor;

  if (
    useAsBillingStart &&
    existingAnchor &&
    nextAnchor !== existingAnchor &&
    Number(agreement.recurring_count) > 0 &&
    !checkbox(formData, "confirm_billing_change")
  ) {
    return {
      error:
        "Recurring payments already exist against the current billing start date. Confirm the recalculation before moving it.",
      ok: null,
    };
  }

  const liveColumn = service === "ads" ? "ads_live_date" : "automation_live_date";
  const statusColumn = service === "ads" ? "ads_status" : "automation_status";

  await exec(
    `update public.income_agreements
        set ${liveColumn} = $1, ${statusColumn} = 'live', ${anchorColumn} = $2,
            status = case when status = 'pending' then 'active' else status end,
            updated_at = now()
      where id = $3`,
    [liveDate, nextAnchor, id]
  );

  revalidateIncome();
  return {
    error: null,
    ok: `${service === "ads" ? "Ads" : "AI automation"} marked live for ${agreement.client_name}.`,
  };
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

  const paid = await alreadyPaid(target);
  const remaining = Math.max(0, target.agreed - paid);
  if (amount > remaining + 0.001) {
    return {
      error: `Only ${money(remaining, target.currency)} is still outstanding on this ${
        target.paymentFor === "recurring" ? "billing cycle" : target.paymentFor
      }. Record the difference against the cycle or balance it actually pays.`,
      ok: null,
    };
  }

  await exec(
    `insert into public.income_payments
       (agreement_id, payment_for, billing_period_start, billing_stream, amount, paid_on,
        received_in, money_account_id, account_name, method, reference, note, recorded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      agreementId,
      paymentFor,
      target.period,
      target.stream,
      amount,
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

  const paidByOthers = await alreadyPaid(target, paymentId);
  const available = Math.max(0, target.agreed - paidByOthers);
  if (amount > available + 0.001) {
    return {
      error: `Only ${money(available, target.currency)} of this balance is unpaid by other records.`,
      ok: null,
    };
  }

  const changed = await exec(
    `update public.income_payments
        set amount = $1, paid_on = $2, received_in = $3, money_account_id = $4,
            account_name = $5, method = $6, reference = $7, note = $8,
            billing_period_start = $9, updated_by = $10, updated_at = now()
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
