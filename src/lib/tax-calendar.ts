import { claimedVat } from "./funds";
import { bsMonthKey, bsMonthLabel, bsMonthRange, bsMonthEnd, fiscalYearOf, formatBs, returnDueDate, shiftBsMonth } from "./nepali-date";
import type { CompanyBill, IncomePayment, OtherIncome, TaxPayment } from "./types";

/**
 * What Avernek owes IRD and when, month by Nepali month. The rules it follows
 * (IRD; confirm anything unusual with IRD or an auditor):
 *
 *   VAT   A return for every Nepali month, even with nothing to pay (a "nil"
 *         return), filed and paid by the 25th of the next month. VAT collected
 *         from clients, less the VAT on bills that can be claimed, is what is
 *         paid; a month with more claimable VAT carries the credit forward.
 *   TDS   Tax held back from salaries, rent and some payments, deposited and
 *         filed (e-TDS) by the 25th of the next month.
 *   Income tax  Paid in advance: 40% of the year's estimate by Poush end, 70%
 *         by Chaitra end, 100% by Ashadh end (not needed under NPR 7,500); the
 *         annual return by Ashwin end, three months after the year ends.
 */

export type PeriodStatus = "open" | "due" | "late" | "filed";

export type VatPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  /** VAT on receipts in the month (output VAT). */
  collected: number;
  /** VAT on bills dated in the month that is claimed (input VAT). */
  deductible: number;
  /** Credit carried in from earlier months. */
  carriedIn: number;
  /** What this month's return asks to pay. */
  payable: number;
  /** Recorded as paid for this month. */
  paid: number;
  filed: boolean;
  due: string;
  status: PeriodStatus;
};

export type TdsPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  /** TDS clients held back from what they paid us: a credit for Avernek. */
  heldFromUs: number;
  /** Salaries paid in the month (TDS usually applies). */
  salaries: number;
  deposited: number;
  filed: boolean;
  due: string;
  status: PeriodStatus | "none";
};

export type Deadline = {
  key: string;
  kind: "vat" | "tds" | "advance" | "annual";
  title: string;
  detail: string;
  due: string;
  dueBs: string;
  amount?: number;
  late: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function months(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  for (let key = startKey; key <= endKey && keys.length < 240; key = shiftBsMonth(key, 1)) keys.push(key);
  return keys;
}

function statusOf(key: string, todayKey: string, filed: boolean, due: string, today: string): PeriodStatus {
  if (key >= todayKey) return "open";
  if (filed) return "filed";
  return today <= due ? "due" : "late";
}

/** The first Nepali month the books cover: the earliest VAT or TDS record. */
export function firstTaxMonth(input: {
  payments: Pick<IncomePayment, "paid_on">[];
  otherIncome: Pick<OtherIncome, "received_on">[];
  bills: Pick<CompanyBill, "bill_date">[];
  taxPayments: Pick<TaxPayment, "period_key" | "paid_on">[];
  today: string;
}): string {
  const dates = [
    ...input.payments.map((row) => row.paid_on),
    ...input.otherIncome.map((row) => row.received_on),
    ...input.bills.map((row) => row.bill_date),
  ].filter((date) => date && date <= input.today);
  const keys = [
    ...dates.map(bsMonthKey),
    ...input.taxPayments.map((row) => row.period_key).filter((key): key is string => Boolean(key && /^\d{4}-\d{2}$/.test(key))),
  ].sort();
  return keys[0] ?? bsMonthKey(input.today);
}

export function vatPeriods(input: {
  payments: Pick<IncomePayment, "paid_on" | "vat_amount">[];
  otherIncome: Pick<OtherIncome, "received_on" | "vat_amount">[];
  bills: Pick<CompanyBill, "bill_date" | "vat_amount" | "claim_vat">[];
  taxPayments: Pick<TaxPayment, "tax_type" | "period_key" | "amount">[];
  startKey: string;
  today: string;
}): VatPeriod[] {
  const todayKey = bsMonthKey(input.today);
  const sumBy = new Map<string, { collected: number; deductible: number; paid: number; filed: boolean }>();
  const slot = (key: string) => {
    if (!sumBy.has(key)) sumBy.set(key, { collected: 0, deductible: 0, paid: 0, filed: false });
    return sumBy.get(key)!;
  };
  for (const row of input.payments) slot(bsMonthKey(row.paid_on)).collected += Number(row.vat_amount ?? 0);
  for (const row of input.otherIncome) slot(bsMonthKey(row.received_on)).collected += Number(row.vat_amount ?? 0);
  for (const bill of input.bills) slot(bsMonthKey(bill.bill_date)).deductible += claimedVat(bill);
  for (const row of input.taxPayments) {
    if (row.tax_type !== "vat" || !row.period_key) continue;
    const entry = slot(row.period_key);
    entry.paid += Number(row.amount);
    entry.filed = true;
  }

  let credit = 0;
  return months(input.startKey, todayKey).map((key) => {
    const entry = sumBy.get(key) ?? { collected: 0, deductible: 0, paid: 0, filed: false };
    const carriedIn = credit;
    const balance = entry.collected - entry.deductible - carriedIn;
    credit = Math.max(0, -balance);
    const { from, to } = bsMonthRange(key);
    const due = returnDueDate(key);
    return {
      key,
      label: bsMonthLabel(key),
      from,
      to,
      collected: round2(entry.collected),
      deductible: round2(entry.deductible),
      carriedIn: round2(carriedIn),
      payable: round2(Math.max(0, balance)),
      paid: round2(entry.paid),
      filed: entry.filed,
      due,
      status: statusOf(key, todayKey, entry.filed, due, input.today),
    };
  });
}

export function tdsPeriods(input: {
  payments: Pick<IncomePayment, "paid_on" | "tds_amount">[];
  otherIncome: Pick<OtherIncome, "received_on" | "tds_amount">[];
  salaries: { date: string; amount: number }[];
  taxPayments: Pick<TaxPayment, "tax_type" | "period_key" | "amount">[];
  startKey: string;
  today: string;
}): TdsPeriod[] {
  const todayKey = bsMonthKey(input.today);
  const sumBy = new Map<string, { heldFromUs: number; salaries: number; deposited: number; filed: boolean }>();
  const slot = (key: string) => {
    if (!sumBy.has(key)) sumBy.set(key, { heldFromUs: 0, salaries: 0, deposited: 0, filed: false });
    return sumBy.get(key)!;
  };
  for (const row of input.payments) slot(bsMonthKey(row.paid_on)).heldFromUs += Number(row.tds_amount ?? 0);
  for (const row of input.otherIncome) slot(bsMonthKey(row.received_on)).heldFromUs += Number(row.tds_amount ?? 0);
  for (const row of input.salaries) if (row.date <= input.today) slot(bsMonthKey(row.date)).salaries += row.amount;
  for (const row of input.taxPayments) {
    if (row.tax_type !== "tds" || !row.period_key) continue;
    const entry = slot(row.period_key);
    entry.deposited += Number(row.amount);
    entry.filed = true;
  }
  return months(input.startKey, todayKey).map((key) => {
    const entry = sumBy.get(key) ?? { heldFromUs: 0, salaries: 0, deposited: 0, filed: false };
    const { from, to } = bsMonthRange(key);
    const due = returnDueDate(key);
    const owes = entry.salaries > 0;
    return {
      key,
      label: bsMonthLabel(key),
      from,
      to,
      heldFromUs: round2(entry.heldFromUs),
      salaries: round2(entry.salaries),
      deposited: round2(entry.deposited),
      filed: entry.filed,
      due,
      status: !owes && !entry.filed ? "none" : statusOf(key, todayKey, entry.filed, due, input.today),
    };
  });
}

/** What is coming up (and anything late), soonest first. */
export function upcomingDeadlines(input: {
  vat: VatPeriod[];
  tds: TdsPeriod[];
  startKey: string;
  today: string;
}): Deadline[] {
  const list: Deadline[] = [];
  for (const period of input.vat) {
    if (period.status === "filed") continue;
    const nil = period.payable === 0;
    list.push({
      key: `vat-${period.key}`,
      kind: "vat",
      title: `VAT return · ${period.label}`,
      detail: period.status === "open" ? "This month is still running; file once it ends." : nil ? "Nothing to pay: file a nil return." : "File the return and pay.",
      due: period.due,
      dueBs: formatBs(period.due),
      amount: period.payable,
      late: period.status === "late",
    });
  }
  for (const period of input.tds) {
    if (period.status === "none" || period.status === "filed") continue;
    list.push({
      key: `tds-${period.key}`,
      kind: "tds",
      title: `TDS · ${period.label}`,
      detail: `Salaries of NPR ${period.salaries.toLocaleString("en-IN")} were paid: deposit the tax held back and file e-TDS.`,
      due: period.due,
      dueBs: formatBs(period.due),
      late: period.status === "late",
    });
  }

  // Income tax for each fiscal year the company has existed in.
  const firstYear = fiscalYearOf(bsMonthRange(input.startKey).from).start;
  const thisYear = fiscalYearOf(input.today).start;
  for (let year = firstYear; year <= thisYear; year++) {
    const label = `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
    // The Nepali year turns at Baishakh: Poush and Chaitra fall in the year
    // the fiscal year starts, Ashadh in the next one.
    const installments: [string, number, number, string][] = [
      ["40%", year, 9, "Poush"],
      ["70%", year, 12, "Chaitra"],
      ["100%", year + 1, 3, "Ashadh"],
    ];
    for (const [share, bsYear, month, name] of installments) {
      const due = bsMonthEnd(bsYear, month);
      if (due < input.today) continue;
      list.push({
        key: `advance-${label}-${month}`,
        kind: "advance",
        title: `Advance income tax · ${share} · FY ${label}`,
        detail: `Pay ${share} of this year's expected income tax by ${name} end. Not needed if the year's tax is under NPR 7,500.`,
        due,
        dueBs: formatBs(due),
        late: false,
      });
    }
    const annualDue = bsMonthEnd(year + 1, 6);
    if (annualDue >= input.today) {
      list.push({
        key: `annual-${label}`,
        kind: "annual",
        title: `Income tax return · FY ${label}`,
        detail: "File the year's income tax return and pay any tax still due. Filing can be extended by 3 months; paying cannot.",
        due: annualDue,
        dueBs: formatBs(annualDue),
        late: false,
      });
    }
  }
  return list.sort((a, b) => Number(b.late) - Number(a.late) || a.due.localeCompare(b.due));
}

/** Days from `today` to `due`; negative when late. */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
