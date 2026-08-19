import type {
  IncomeAgreement,
  IncomePayment,
  IncomeServiceType,
} from "@/lib/types";

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

export function addCalendarDays(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function daysBetween(from: string, to: string) {
  return Math.floor((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

export function formatIncomeMoney(amount: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-NP", {
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

export function setupTermsLabel(agreement: IncomeAgreement): string {
  if (agreement.setup_payment_terms === "full_upfront") return "Full setup upfront";
  if (agreement.setup_payment_terms === "half_advance") {
    return `${Number(agreement.setup_advance_percent)}% advance · rest on ads-live day`;
  }
  return "Custom / partial setup payments";
}

export function serviceTypeLabel(serviceType: IncomeServiceType): string {
  if (serviceType === "ai_automation") return "AI automation";
  if (serviceType === "marketing") return "Marketing";
  return "Full track · AI automation + marketing";
}

export type RecurringPeriod = {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  agreed: number;
  paid: number;
  remaining: number;
  isDue: boolean;
};

export type IncomeAgreementSummary = {
  setupPaid: number;
  setupRemaining: number;
  setupDueNow: number;
  setupNextDueDate: string | null;
  recurringPaid: number;
  recurringDueNow: number;
  overdueRecurring: number;
  nextRecurringDueDate: string | null;
  nextRecurringPeriodStart: string | null;
  totalCollected: number;
  totalDueNow: number;
  cycleState: "not_started" | "running" | "ended";
  currentCycleNumber: number;
  currentCycleDay: number;
  currentCycleStart: string | null;
  currentCycleEnd: string | null;
  nextCycleStart: string | null;
  daysUntilNextCycle: number;
  cycleProgress: number;
  periods: RecurringPeriod[];
};

/**
 * Generate recurring obligations in exact 30-day service cycles. Ads-live is
 * day 1 of cycle one (covered by setup); recurring billing starts on day 31.
 * Payments stay allocated to a specific cycle so a prepayment cannot hide an
 * older unpaid cycle.
 */
export function summarizeIncomeAgreement(
  agreement: IncomeAgreement,
  payments: IncomePayment[],
  today = new Date().toISOString().slice(0, 10)
): IncomeAgreementSummary {
  const ownPayments = payments.filter((payment) => payment.agreement_id === agreement.id);
  const setupPayments = ownPayments.filter((payment) => payment.payment_for === "setup");
  const recurringPayments = ownPayments.filter(
    (payment) => payment.payment_for === "recurring"
  );
  const setupPaid = setupPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const setupAmount = Number(agreement.setup_amount);
  const setupRemaining = Math.max(0, setupAmount - setupPaid);

  const hasStarted = today >= agreement.ads_live_date;
  const hasEnded =
    agreement.status === "completed" &&
    Boolean(agreement.service_end_date && agreement.service_end_date <= today);
  const cycleReferenceDate =
    hasEnded && agreement.service_end_date ? agreement.service_end_date : today;
  const elapsedDays = hasStarted
    ? Math.max(0, daysBetween(agreement.ads_live_date, cycleReferenceDate))
    : 0;
  const cycleIndex = Math.floor(elapsedDays / 30);
  const currentCycleStart = hasStarted
    ? addCalendarDays(agreement.ads_live_date, cycleIndex * 30)
    : null;
  const currentCycleDay = hasStarted ? (elapsedDays % 30) + 1 : 0;
  const nextCycleStart = hasEnded
    ? null
    : hasStarted
      ? addCalendarDays(agreement.ads_live_date, (cycleIndex + 1) * 30)
      : agreement.ads_live_date;
  const daysUntilNextCycle = hasEnded
    ? 0
    : hasStarted
      ? 30 - (elapsedDays % 30)
      : Math.max(0, daysBetween(today, agreement.ads_live_date));

  let setupDueNow = 0;
  let setupNextDueDate: string | null = null;
  if (setupRemaining > 0) {
    if (agreement.setup_payment_terms === "half_advance") {
      const advance = (setupAmount * Number(agreement.setup_advance_percent)) / 100;
      if (setupPaid < advance) {
        setupNextDueDate = agreement.setup_due_date;
        if (agreement.setup_due_date <= today) setupDueNow = advance - setupPaid;
      } else {
        setupNextDueDate = agreement.ads_live_date;
        if (agreement.ads_live_date <= today) setupDueNow = setupRemaining;
      }
    } else {
      setupNextDueDate = agreement.setup_due_date;
      if (agreement.setup_due_date <= today) setupDueNow = setupRemaining;
    }
  }

  const paidByPeriod = new Map<string, number>();
  for (const payment of recurringPayments) {
    if (!payment.billing_period_start) continue;
    paidByPeriod.set(
      payment.billing_period_start,
      (paidByPeriod.get(payment.billing_period_start) ?? 0) + Number(payment.amount)
    );
  }

  // Include every due period, every prepaid period, and twelve upcoming choices.
  const latestPaidPeriod = [...paidByPeriod.keys()].sort().at(-1) ?? "";
  const periods: RecurringPeriod[] = [];
  let upcomingIncluded = 0;
  for (let index = 1; index <= 240; index += 1) {
    const periodStart = addCalendarDays(agreement.ads_live_date, index * 30);
    if (
      agreement.service_end_date &&
      periodStart > agreement.service_end_date &&
      periodStart > latestPaidPeriod
    ) {
      break;
    }
    const dueDate = addCalendarDays(
      periodStart,
      -Number(agreement.recurring_due_days_before)
    );
    const isDue = dueDate <= today;
    if (!isDue && periodStart > latestPaidPeriod) upcomingIncluded += 1;

    const paid = paidByPeriod.get(periodStart) ?? 0;
    const agreed = Number(agreement.recurring_amount);
    periods.push({
      periodStart,
      periodEnd: addCalendarDays(periodStart, 29),
      dueDate,
      agreed,
      paid,
      remaining: Math.max(0, agreed - paid),
      isDue,
    });

    if (
      agreement.status !== "active" &&
      !agreement.service_end_date &&
      periodStart > latestPaidPeriod
    ) {
      break;
    }
    if (!isDue && periodStart > latestPaidPeriod && upcomingIncluded >= 12) break;
  }

  const recurringPaid = recurringPayments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0
  );
  const duePeriods = periods.filter((period) => period.isDue && period.remaining > 0);
  const recurringDueNow = duePeriods.reduce((sum, period) => sum + period.remaining, 0);
  const overdueRecurring = duePeriods
    .filter((period) => period.dueDate < today)
    .reduce((sum, period) => sum + period.remaining, 0);
  const nextPeriod = periods.find((period) => period.remaining > 0) ?? null;

  return {
    setupPaid,
    setupRemaining,
    setupDueNow,
    setupNextDueDate,
    recurringPaid,
    recurringDueNow,
    overdueRecurring,
    nextRecurringDueDate: nextPeriod?.dueDate ?? null,
    nextRecurringPeriodStart: nextPeriod?.periodStart ?? null,
    totalCollected: setupPaid + recurringPaid,
    totalDueNow: setupDueNow + recurringDueNow,
    cycleState: hasEnded ? "ended" : hasStarted ? "running" : "not_started",
    currentCycleNumber: hasStarted ? cycleIndex + 1 : 0,
    currentCycleDay,
    currentCycleStart,
    currentCycleEnd: currentCycleStart ? addCalendarDays(currentCycleStart, 29) : null,
    nextCycleStart,
    daysUntilNextCycle,
    cycleProgress: hasStarted ? Math.min(100, (currentCycleDay / 30) * 100) : 0,
    periods,
  };
}

export function periodLabel(period: Pick<RecurringPeriod, "periodStart" | "periodEnd">) {
  const formatter = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(utcDate(period.periodStart))} – ${formatter.format(
    utcDate(period.periodEnd)
  )}`;
}
