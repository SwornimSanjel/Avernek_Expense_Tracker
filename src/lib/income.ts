import type {
  AdsStatus,
  AutomationStatus,
  BillingStatus,
  BillingStream,
  CapitalInflowType,
  IncomeAgreement,
  IncomePayment,
  IncomePaymentMethod,
  IncomeServiceType,
  ServiceKey,
  WebsiteStatus,
} from "@/lib/types";

/**
 * Everything money-related on a client is DERIVED here, never stored:
 * totals paid, remaining balances, payment status, the current billing cycle,
 * the next due date and the overdue state. The database keeps only the source
 * facts — agreed amounts, the dates an admin chose, and the payment rows — so
 * no two stored fields can contradict each other.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(value: string) {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function utcDate(value: string) {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isValidDate(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addCalendarDays(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/**
 * Calendar-month arithmetic, not 30-day arithmetic. Billing anchored on the
 * 31st lands on the 30th, the 28th or the 29th when the target month is
 * shorter, and keeps counting from the stored anchor rather than drifting.
 */
export function addCalendarMonths(value: string, months: number): string {
  const { year, month, day } = dateParts(value);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))));
}

function daysBetween(from: string, to: string) {
  return Math.floor((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

export function daysUntilDate(
  value: string,
  today = todayIso()
) {
  return daysBetween(today, value);
}

/**
 * "Today" in the app's own convention: the calendar date as the browser/server
 * reads it locally, formatted as the same YYYY-MM-DD string every stored date
 * uses. Comparisons stay string-to-string, so no timezone shifts a due date.
 */
export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function formatIncomeMoney(amount: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-NP", {
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

export function formatServiceDate(value: string | null, fallback = "Not set"): string {
  if (!isValidDate(value)) return fallback;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(value));
}

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------

export const SERVICE_KEYS: ServiceKey[] = ["website", "ads", "automation"];

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  website: "Website",
  ads: "Ads / Marketing",
  automation: "AI Automation",
};

export const SERVICE_BADGES: Record<ServiceKey, string> = {
  website: "Website",
  ads: "Ads",
  automation: "Automation",
};

export function agreementServices(agreement: IncomeAgreement): ServiceKey[] {
  const services: ServiceKey[] = [];
  if (agreement.has_website) services.push("website");
  if (agreement.has_ads) services.push("ads");
  if (agreement.has_automation) services.push("automation");
  return services;
}

export function hasRecurringService(agreement: IncomeAgreement): boolean {
  return agreement.has_ads || agreement.has_automation;
}

export function servicesLabel(agreement: IncomeAgreement): string {
  const services = agreementServices(agreement);
  if (!services.length) return "No service selected";
  return services.map((service) => SERVICE_LABELS[service]).join(" + ");
}

/**
 * The legacy service_type column is kept in sync from the flags so old exports
 * and SQL reports keep working. Nothing in the app reads it back.
 */
export function legacyServiceType(services: {
  website: boolean;
  ads: boolean;
  automation: boolean;
}): IncomeServiceType {
  if (services.ads && services.automation) return "full_track";
  if (services.ads && !services.website && !services.automation) return "marketing";
  if (services.automation && !services.website && !services.ads) return "ai_automation";
  if (services.website && !services.ads && !services.automation) return "website";
  return "custom";
}

export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  review: "In review",
  completed: "Completed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export const ADS_STATUS_LABELS: Record<AdsStatus, string> = {
  not_started: "Not started",
  preparation: "Preparation",
  ready: "Ready",
  live: "Live",
  paused: "Paused",
  stopped: "Stopped",
};

export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  not_started: "Not started",
  development: "Development",
  testing: "Testing",
  ready: "Ready",
  live: "Live",
  paused: "Paused",
  stopped: "Stopped",
};

export const AGREEMENT_STATUS_LABELS: Record<IncomeAgreement["status"], string> = {
  active: "Active",
  pending: "Pending",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD_LABELS: Record<IncomePaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  wallet: "Digital wallet",
  card: "Card",
  other: "Other",
};

export const CAPITAL_INFLOW_LABELS: Record<CapitalInflowType, string> = {
  founder_investment: "Founder investment / capital injection",
  owner_contribution: "Owner contribution",
  loan_received: "Loan received",
  other_non_revenue: "Other non-revenue funds",
};

export function setupTermsLabel(agreement: IncomeAgreement): string {
  if (agreement.setup_payment_terms === "full_upfront") return "Full setup upfront";
  if (agreement.setup_payment_terms === "half_advance") {
    return `${Number(agreement.setup_advance_percent)}% advance · rest on the service-live day`;
  }
  return "Custom / partial setup payments";
}

/** Kept for older call sites; prefer servicesLabel(agreement). */
export function serviceTypeLabel(serviceType: IncomeServiceType): string {
  if (serviceType === "ai_automation") return "AI Automation";
  if (serviceType === "marketing") return "Ads / Marketing";
  if (serviceType === "website") return "Website";
  if (serviceType === "full_track") return "Ads / Marketing + AI Automation";
  return "Custom service mix";
}

// -----------------------------------------------------------------------------
// Billing status
// -----------------------------------------------------------------------------

/**
 * One rule used everywhere: nothing agreed is "paid", a covered balance is
 * "paid", part of it is "partial", and anything still owed past its due date
 * is "overdue".
 */
export function billingStatus(
  agreed: number,
  paid: number,
  dueDate: string | null,
  today: string
): BillingStatus {
  if (agreed <= 0) return "paid";
  if (paid + 0.001 >= agreed) return "paid";
  if (isValidDate(dueDate) && dueDate < today) return "overdue";
  return paid > 0 ? "partial" : "unpaid";
}

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
};

export type BillingBucket = {
  agreed: number;
  paid: number;
  remaining: number;
  dueDate: string | null;
  status: BillingStatus;
  /** The payment date on which the balance first reached zero, or an override. */
  paidInFullDate: string | null;
  payments: IncomePayment[];
};

/**
 * The date a balance was cleared: the payment that took the running total to
 * or past the agreed amount. `override` wins so an admin can correct it.
 */
function paidInFullDate(
  payments: IncomePayment[],
  agreed: number,
  override: string | null
): string | null {
  if (isValidDate(override)) return override;
  if (agreed <= 0) return null;
  let running = 0;
  const ordered = [...payments].sort((a, b) =>
    a.paid_on === b.paid_on ? a.created_at.localeCompare(b.created_at) : a.paid_on.localeCompare(b.paid_on)
  );
  for (const payment of ordered) {
    running += Number(payment.amount);
    if (running + 0.001 >= agreed) return payment.paid_on;
  }
  return null;
}

function buildBucket(
  agreed: number,
  payments: IncomePayment[],
  dueDate: string | null,
  override: string | null,
  today: string
): BillingBucket {
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  return {
    agreed,
    paid,
    remaining: Math.max(0, agreed - paid),
    dueDate: isValidDate(dueDate) ? dueDate : null,
    status: billingStatus(agreed, paid, dueDate, today),
    paidInFullDate: paidInFullDate(payments, agreed, override),
    payments,
  };
}

// -----------------------------------------------------------------------------
// Recurring billing
// -----------------------------------------------------------------------------

export type RecurringPeriod = {
  stream: BillingStream;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  agreed: number;
  paid: number;
  remaining: number;
  isDue: boolean;
  status: BillingStatus;
};

export type RecurringStreamSummary = {
  key: BillingStream;
  label: string;
  monthlyAmount: number;
  /** The anchor every cycle counts from. Null until the admin sets it. */
  billingStartDate: string | null;
  started: boolean;
  /** The cycle covering today, whether or not it is billable. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  currentCycleNumber: number;
  cycleProgress: number;
  nextCycleStart: string | null;
  daysUntilNextCycle: number;
  periods: RecurringPeriod[];
  paid: number;
  dueNow: number;
  overdue: number;
  nextDuePeriod: RecurringPeriod | null;
  lastPaymentDate: string | null;
};

export type IncomeAgreementSummary = {
  services: ServiceKey[];
  setup: BillingBucket;
  website: BillingBucket | null;
  recurring: {
    mode: IncomeAgreement["recurring_billing_mode"];
    streams: RecurringStreamSummary[];
    monthlyTotal: number;
    paid: number;
    dueNow: number;
    overdue: number;
    /** Earliest unsettled cycle across every stream. */
    nextDuePeriod: RecurringPeriod | null;
    nextDueDate: string | null;
    started: boolean;
    /** True when a recurring service exists but has no billing anchor yet. */
    awaitingStart: boolean;
  };
  totalAgreedOneOff: number;
  totalCollected: number;
  totalDueNow: number;
  totalOverdue: number;
  outstanding: number;
  /** Worst status across setup, website and the due recurring cycles. */
  overallStatus: BillingStatus;
  nextDueDate: string | null;
  nextDueLabel: string | null;
  lastPaymentDate: string | null;
  serviceLive: boolean;
};

function streamLabel(key: BillingStream): string {
  if (key === "ads") return "Ads / Marketing";
  if (key === "automation") return "AI Automation";
  return "Monthly service";
}

/**
 * Cycles for one recurring stream.
 *
 * The anchor is the stream's own billing start date — the day the service
 * actually began being billed, which is normally the live date but stays
 * editable because contracts differ. Cycle 1 runs anchor → anchor+1 month − 1
 * day. When the setup fee covered that first cycle (the usual arrangement),
 * the first invoice is the cycle starting one calendar month after the anchor.
 *
 * A period is generated for every cycle that has come due, every cycle someone
 * has already paid for, and twelve upcoming cycles so a prepayment can be
 * recorded. Payments stay attached to a specific cycle, so paying next month
 * early can never hide an unpaid cycle from this month.
 */
function summarizeStream(
  key: BillingStream,
  monthlyAmount: number,
  billingStartDate: string | null,
  agreement: IncomeAgreement,
  payments: IncomePayment[],
  today: string
): RecurringStreamSummary {
  const streamPayments = payments.filter(
    (payment) =>
      payment.payment_for === "recurring" &&
      (payment.billing_stream ?? "combined") === key
  );
  const paid = streamPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const paidByPeriod = new Map<string, number>();
  for (const payment of streamPayments) {
    if (!payment.billing_period_start) continue;
    paidByPeriod.set(
      payment.billing_period_start,
      (paidByPeriod.get(payment.billing_period_start) ?? 0) + Number(payment.amount)
    );
  }
  const lastPaymentDate =
    streamPayments.map((payment) => payment.paid_on).sort().at(-1) ?? null;

  const anchor = isValidDate(billingStartDate) ? billingStartDate : null;
  if (!anchor) {
    return {
      key,
      label: streamLabel(key),
      monthlyAmount,
      billingStartDate: null,
      started: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      currentCycleNumber: 0,
      cycleProgress: 0,
      nextCycleStart: null,
      daysUntilNextCycle: 0,
      periods: [],
      paid,
      dueNow: 0,
      overdue: 0,
      nextDuePeriod: null,
      lastPaymentDate,
    };
  }

  const ended =
    isValidDate(agreement.service_end_date) && agreement.service_end_date <= today;
  const referenceDate = ended ? agreement.service_end_date! : today;
  const started = today >= anchor;

  let cycleIndex = 0;
  if (started) {
    while (addCalendarMonths(anchor, cycleIndex + 1) <= referenceDate) cycleIndex += 1;
  }
  const currentPeriodStart = started ? addCalendarMonths(anchor, cycleIndex) : null;
  const followingCycleStart = addCalendarMonths(anchor, started ? cycleIndex + 1 : 0);
  const cycleLength = currentPeriodStart
    ? daysBetween(currentPeriodStart, addCalendarMonths(anchor, cycleIndex + 1))
    : 0;
  const cycleDay = currentPeriodStart
    ? daysBetween(currentPeriodStart, referenceDate) + 1
    : 0;

  const firstBillableIndex = agreement.setup_covers_first_cycle ? 1 : 0;
  const latestPaidPeriod = [...paidByPeriod.keys()].sort().at(-1) ?? "";
  const dueDaysBefore = Number(agreement.recurring_due_days_before ?? 0);
  const periods: RecurringPeriod[] = [];
  let upcomingIncluded = 0;

  for (let index = firstBillableIndex; index < firstBillableIndex + 480; index += 1) {
    const periodStart = addCalendarMonths(anchor, index);
    if (
      isValidDate(agreement.service_end_date) &&
      periodStart > agreement.service_end_date &&
      periodStart > latestPaidPeriod
    ) {
      break;
    }
    const dueDate = dueDaysBefore > 0 ? addCalendarDays(periodStart, -dueDaysBefore) : periodStart;
    const isDue = dueDate <= today;
    if (!isDue && periodStart > latestPaidPeriod) upcomingIncluded += 1;

    const periodPaid = paidByPeriod.get(periodStart) ?? 0;
    periods.push({
      stream: key,
      periodStart,
      periodEnd: addCalendarDays(addCalendarMonths(periodStart, 1), -1),
      dueDate,
      agreed: monthlyAmount,
      paid: periodPaid,
      remaining: Math.max(0, monthlyAmount - periodPaid),
      isDue,
      status: billingStatus(monthlyAmount, periodPaid, dueDate, today),
    });

    const stoppedBilling =
      agreement.status !== "active" && agreement.status !== "pending";
    if (stoppedBilling && !isValidDate(agreement.service_end_date) && periodStart > latestPaidPeriod) {
      break;
    }
    if (!isDue && periodStart > latestPaidPeriod && upcomingIncluded >= 12) break;
  }

  const duePeriods = periods.filter((period) => period.isDue && period.remaining > 0);

  return {
    key,
    label: streamLabel(key),
    monthlyAmount,
    billingStartDate: anchor,
    started,
    currentPeriodStart,
    currentPeriodEnd: currentPeriodStart ? addCalendarDays(followingCycleStart, -1) : null,
    currentCycleNumber: started ? cycleIndex + 1 : 0,
    cycleProgress:
      started && cycleLength > 0 ? Math.min(100, (cycleDay / cycleLength) * 100) : 0,
    nextCycleStart: ended ? null : followingCycleStart,
    daysUntilNextCycle: ended ? 0 : Math.max(0, daysBetween(today, followingCycleStart)),
    periods,
    paid,
    dueNow: duePeriods.reduce((sum, period) => sum + period.remaining, 0),
    overdue: duePeriods
      .filter((period) => period.dueDate < today)
      .reduce((sum, period) => sum + period.remaining, 0),
    nextDuePeriod: periods.find((period) => period.remaining > 0) ?? null,
    lastPaymentDate,
  };
}

const STATUS_SEVERITY: Record<BillingStatus, number> = {
  paid: 0,
  unpaid: 1,
  partial: 2,
  overdue: 3,
};

function worstStatus(statuses: BillingStatus[]): BillingStatus {
  return statuses.reduce<BillingStatus>(
    (worst, status) => (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst),
    "paid"
  );
}

/**
 * The complete money picture for one client, computed from the agreement plus
 * its payment rows. Pass every payment; rows for other agreements are ignored.
 */
export function summarizeIncomeAgreement(
  agreement: IncomeAgreement,
  payments: IncomePayment[],
  today = todayIso()
): IncomeAgreementSummary {
  const ownPayments = payments.filter((payment) => payment.agreement_id === agreement.id);
  const setupPayments = ownPayments.filter((payment) => payment.payment_for === "setup");
  const websitePayments = ownPayments.filter((payment) => payment.payment_for === "website");

  const setupAmount = Number(agreement.setup_amount);
  const setup = buildBucket(
    setupAmount,
    setupPayments,
    setupDueDate(agreement, setupPayments),
    agreement.setup_paid_in_full_date,
    today
  );

  const website = agreement.has_website
    ? buildBucket(
        Number(agreement.website_amount),
        websitePayments,
        agreement.website_due_date,
        agreement.website_paid_in_full_date,
        today
      )
    : null;

  const streams: RecurringStreamSummary[] = [];
  if (hasRecurringService(agreement)) {
    if (agreement.recurring_billing_mode === "separate") {
      if (agreement.has_ads) {
        streams.push(
          summarizeStream(
            "ads",
            Number(agreement.ads_monthly_amount ?? 0),
            agreement.ads_billing_start_date ?? agreement.recurring_billing_start_date,
            agreement,
            ownPayments,
            today
          )
        );
      }
      if (agreement.has_automation) {
        streams.push(
          summarizeStream(
            "automation",
            Number(agreement.automation_monthly_amount ?? 0),
            agreement.automation_billing_start_date ?? agreement.recurring_billing_start_date,
            agreement,
            ownPayments,
            today
          )
        );
      }
    } else {
      streams.push(
        summarizeStream(
          "combined",
          Number(agreement.recurring_amount),
          agreement.recurring_billing_start_date,
          agreement,
          ownPayments,
          today
        )
      );
    }
  }

  // A payment recorded against a stream that no longer exists (the service was
  // removed, or the mode changed) still counts as money collected. History is
  // never dropped just because the configuration moved on.
  const countedRecurring = new Set(streams.flatMap((stream) => stream.key));
  const orphanRecurringPaid = ownPayments
    .filter(
      (payment) =>
        payment.payment_for === "recurring" &&
        !countedRecurring.has(payment.billing_stream ?? "combined")
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  const recurringPaid =
    streams.reduce((sum, stream) => sum + stream.paid, 0) + orphanRecurringPaid;
  const recurringDueNow = streams.reduce((sum, stream) => sum + stream.dueNow, 0);
  const recurringOverdue = streams.reduce((sum, stream) => sum + stream.overdue, 0);
  const candidateDuePeriods = streams
    .map((stream) => stream.nextDuePeriod)
    .filter((period): period is RecurringPeriod => Boolean(period))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextDuePeriod = candidateDuePeriods[0] ?? null;

  const setupDueNow = setup.dueDate && setup.dueDate <= today ? setup.remaining : 0;
  const websiteDueNow =
    website && website.dueDate && website.dueDate <= today ? website.remaining : 0;

  const totalCollected = setup.paid + (website?.paid ?? 0) + recurringPaid;
  const totalDueNow = setupDueNow + websiteDueNow + recurringDueNow;
  const totalOverdue =
    (setup.status === "overdue" ? setup.remaining : 0) +
    (website?.status === "overdue" ? website.remaining : 0) +
    recurringOverdue;

  const nextDates: { date: string; label: string }[] = [];
  if (setup.remaining > 0 && setup.dueDate) {
    nextDates.push({ date: setup.dueDate, label: "Setup balance" });
  }
  if (website && website.remaining > 0 && website.dueDate) {
    nextDates.push({ date: website.dueDate, label: "Website balance" });
  }
  if (nextDuePeriod) {
    nextDates.push({ date: nextDuePeriod.dueDate, label: "Monthly fee" });
  }
  nextDates.sort((a, b) => a.date.localeCompare(b.date));

  const lastPaymentDate = ownPayments.map((payment) => payment.paid_on).sort().at(-1) ?? null;

  return {
    services: agreementServices(agreement),
    setup,
    website,
    recurring: {
      mode: agreement.recurring_billing_mode,
      streams,
      monthlyTotal: streams.reduce((sum, stream) => sum + stream.monthlyAmount, 0),
      paid: recurringPaid,
      dueNow: recurringDueNow,
      overdue: recurringOverdue,
      nextDuePeriod,
      nextDueDate: nextDuePeriod?.dueDate ?? null,
      started: streams.some((stream) => stream.started),
      awaitingStart:
        hasRecurringService(agreement) && streams.every((stream) => !stream.billingStartDate),
    },
    totalAgreedOneOff: setupAmount + (website?.agreed ?? 0),
    totalCollected,
    totalDueNow,
    totalOverdue,
    outstanding:
      setup.remaining +
      (website?.remaining ?? 0) +
      streams.reduce(
        (sum, stream) =>
          sum +
          stream.periods
            .filter((period) => period.isDue)
            .reduce((periodSum, period) => periodSum + period.remaining, 0),
        0
      ),
    overallStatus: worstStatus([
      setup.status,
      ...(website ? [website.status] : []),
      ...streams.flatMap((stream) =>
        stream.periods.filter((period) => period.isDue).map((period) => period.status)
      ),
    ]),
    nextDueDate: nextDates[0]?.date ?? null,
    nextDueLabel: nextDates[0]?.label ?? null,
    lastPaymentDate,
    serviceLive: agreement.ads_status === "live" || agreement.automation_status === "live",
  };
}

/**
 * When the setup balance is due. A half-advance agreement has two moments: the
 * advance on the agreed due date, then the rest when the service goes live.
 */
function setupDueDate(
  agreement: IncomeAgreement,
  setupPayments: IncomePayment[]
): string | null {
  const setupAmount = Number(agreement.setup_amount);
  const paid = setupPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (setupAmount <= 0 || paid + 0.001 >= setupAmount) return agreement.setup_due_date ?? null;

  if (agreement.setup_payment_terms === "half_advance") {
    const advance = (setupAmount * Number(agreement.setup_advance_percent)) / 100;
    if (paid + 0.001 < advance) return agreement.setup_due_date ?? null;
    const liveDate =
      agreement.recurring_billing_start_date ??
      agreement.ads_live_date ??
      agreement.automation_live_date;
    return isValidDate(liveDate) ? liveDate : agreement.setup_due_date ?? null;
  }
  return agreement.setup_due_date ?? null;
}

export function periodLabel(period: Pick<RecurringPeriod, "periodStart" | "periodEnd">) {
  return `${formatServiceDate(period.periodStart)} – ${formatServiceDate(period.periodEnd)}`;
}

/**
 * The default anchor to offer when a service is marked live: the live date
 * itself. The admin can always override it, and an existing anchor is never
 * replaced silently.
 */
export function suggestedBillingStart(
  agreement: IncomeAgreement,
  liveDate: string
): string {
  return isValidDate(agreement.recurring_billing_start_date)
    ? agreement.recurring_billing_start_date
    : liveDate;
}
