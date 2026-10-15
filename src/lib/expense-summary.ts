import type { Expense, Recurring } from "@/lib/types";
import { fromPaisa, multiplyToPaisa, sumPaisa, toPaisa, type Paisa } from "@/lib/money";

/**
 * Expense totals, shared by the dashboard and the AI assistant so both always
 * report the same figure for the same question.
 *
 * Rules (unchanged from the dashboard):
 *   - totals are in NPR, from amount_npr; an expense without a conversion yet
 *     (a USD charge still waiting for its rate) is counted separately, never
 *     guessed;
 *   - dates are the stored YYYY-MM-DD strings, compared as strings, so no time
 *     zone can move an expense into another month;
 *   - ranges include `from` and exclude `before`.
 */

export type DateRange = {
  /** First day included (YYYY-MM-DD). Open when omitted. */
  from?: string | null;
  /** First day NOT included (YYYY-MM-DD). Open when omitted. */
  before?: string | null;
};

type ExpenseLike = Pick<Expense, "amount" | "amount_npr" | "currency" | "expense_date">;

export function inRange(date: string, range: DateRange = {}): boolean {
  if (range.from && date < range.from) return false;
  if (range.before && date >= range.before) return false;
  return true;
}

export function isConverted(expense: Pick<Expense, "amount_npr">): boolean {
  return expense.amount_npr != null;
}

export function expensesInRange<T extends ExpenseLike>(expenses: T[], range: DateRange = {}): T[] {
  return expenses.filter((expense) => inRange(expense.expense_date, range));
}

/** Exact NPR total of the converted expenses, in paisa. */
export function totalNprPaisa(expenses: ExpenseLike[]): Paisa {
  return sumPaisa(expenses.filter(isConverted).map((expense) => expense.amount_npr));
}

export type ExpenseTotals = {
  /** NPR, every converted expense. */
  totalNpr: number;
  count: number;
  /** Expenses with no NPR amount yet (a USD rate is missing). Not in totalNpr. */
  unconvertedCount: number;
  /** The original dollars of the USD expenses, converted or not. */
  usdAmount: number;
};

export function expenseTotals(expenses: ExpenseLike[], range: DateRange = {}): ExpenseTotals {
  const rows = expensesInRange(expenses, range);
  return {
    totalNpr: fromPaisa(totalNprPaisa(rows)),
    count: rows.length,
    unconvertedCount: rows.filter((expense) => !isConverted(expense)).length,
    usdAmount: fromPaisa(
      sumPaisa(rows.filter((expense) => expense.currency === "USD").map((expense) => expense.amount))
    ),
  };
}

export type ExpenseGroup = { key: string; totalNpr: number; count: number };

/**
 * NPR totals per group, largest first. `keyOf` returns the group key (a
 * category id, a month, …); null groups are kept under the key "".
 */
export function groupExpenses<T extends ExpenseLike>(
  expenses: T[],
  keyOf: (expense: T) => string | null | undefined
): ExpenseGroup[] {
  const groups = new Map<string, { paisa: Paisa; count: number }>();
  for (const expense of expenses) {
    if (!isConverted(expense)) continue;
    const key = keyOf(expense) ?? "";
    const group = groups.get(key) ?? { paisa: 0, count: 0 };
    group.paisa += toPaisa(expense.amount_npr);
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, totalNpr: fromPaisa(group.paisa), count: group.count }))
    .sort((a, b) => b.totalNpr - a.totalNpr || a.key.localeCompare(b.key));
}

/** "2026-10-14" → "2026-10". */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** NPR total per calendar month, for the months given as YYYY-MM-01 starts. */
export function monthlyTotals(
  expenses: ExpenseLike[],
  monthStarts: { from: string; before: string }[]
): number[] {
  return monthStarts.map((month) => fromPaisa(totalNprPaisa(expensesInRange(expenses, month))));
}

/**
 * Subscription renewals expected in the coming month, in NPR: every monthly
 * subscription, plus each annual one renewing within [nextMonthStart,
 * nextMonthEnd). USD subscriptions use the given USD sell rate (0 when there is
 * no rate yet, as on the dashboard).
 */
export function projectedRenewalsNpr(
  recurring: Pick<Recurring, "amount" | "currency" | "cycle" | "next_renewal_date">[],
  usdRate: number | null | undefined,
  nextMonthStart: string,
  nextMonthEnd: string
): number {
  let paisa = 0;
  for (const item of recurring) {
    const due =
      item.cycle === "monthly" ||
      (item.next_renewal_date >= nextMonthStart && item.next_renewal_date < nextMonthEnd);
    if (!due) continue;
    paisa += item.currency === "USD" ? multiplyToPaisa(item.amount, usdRate ?? 0) : toPaisa(item.amount);
  }
  return fromPaisa(paisa);
}
