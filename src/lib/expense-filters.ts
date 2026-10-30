import { monthLabel, monthRange, nepalToday, shiftMonth } from "@/lib/dates";
import { EXPENSE_LEDGERS, type ExpenseLedger } from "@/lib/access";

/**
 * The expense filters as they live in the URL. One parser serves the page and
 * the CSV export, so "Export" always downloads exactly what is on screen.
 */
export type ExpenseSearch = {
  period?: string;
  month?: string;
  from?: string;
  to?: string;
  ledger?: string;
  cat?: string;
  vendor?: string;
  client?: string;
  person?: string;
  payer?: string;
  basis?: string;
  q?: string;
};

export type ExpensePeriod = "month" | "last" | "year" | "all" | "custom" | "future";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export function resolvePeriod(sp: ExpenseSearch, today = nepalToday()) {
  const thisMonth = today.slice(0, 7);
  const requested = (sp.period ?? "") as ExpensePeriod;
  const period: ExpensePeriod = ["month", "last", "year", "all", "custom", "future"].includes(requested)
    ? requested
    : MONTH.test(sp.month ?? "")
      ? "month"
      : "month";

  if (period === "month") {
    const key = MONTH.test(sp.month ?? "") ? sp.month! : thisMonth;
    const { from, to } = monthRange(key);
    return { period, monthKey: key, from, to, label: monthLabel(key) };
  }
  if (period === "last") {
    const key = shiftMonth(thisMonth, -1);
    const { from, to } = monthRange(key);
    return { period, monthKey: key, from, to, label: monthLabel(key) };
  }
  if (period === "year") {
    const year = today.slice(0, 4);
    return { period, monthKey: thisMonth, from: `${year}-01-01`, to: `${year}-12-31`, label: `Year ${year}` };
  }
  if (period === "custom") {
    const from = DATE.test(sp.from ?? "") ? sp.from! : null;
    const to = DATE.test(sp.to ?? "") ? sp.to! : null;
    return { period, monthKey: thisMonth, from, to, label: `${from ?? "Start"} → ${to ?? "today"}` };
  }
  if (period === "future") {
    return { period, monthKey: thisMonth, from: shiftDay(today, 1), to: null, label: "Dated after today" };
  }
  return { period, monthKey: thisMonth, from: null as string | null, to: null as string | null, label: "All time" };
}

function shiftDay(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Which expenses a person may see: the kinds they are allowed, and the VAT
 * accounts (money_accounts.kind = 'company_bank', active or not) that tell
 * the VAT account apart from the personal / non-VAT ones. See lib/access.ts.
 */
export type ExpenseScope = { ledgers: ExpenseLedger[]; vatAccountIds: string[] };

/**
 * SQL condition limiting public.expenses `e` to a scope, or null when the scope
 * is every kind. `push` adds a $n parameter.
 */
export function scopeCondition(scope: ExpenseScope | undefined, push: (value: unknown) => string): string | null {
  if (!scope || EXPENSE_LEDGERS.every((ledger) => scope.ledgers.includes(ledger))) return null;
  const parts: string[] = [];
  if (scope.ledgers.includes("founder")) parts.push(`e.funding_source <> 'company_funds'`);
  if (scope.ledgers.includes("vat") || scope.ledgers.includes("non_vat")) {
    const vat = push(scope.vatAccountIds);
    if (scope.ledgers.includes("vat")) parts.push(`(e.funding_source = 'company_funds' and e.money_account_id = any(${vat}::uuid[]))`);
    if (scope.ledgers.includes("non_vat")) {
      parts.push(`(e.funding_source = 'company_funds' and not coalesce(e.money_account_id = any(${vat}::uuid[]), false))`);
    }
  }
  return parts.length ? `(${parts.join(" or ")})` : "false";
}

/**
 * WHERE clause for public.expenses aliased as `e` (vendors `v`, categories `c`
 * joined). Every value goes through a $n placeholder. `scope` limits it to
 * the expenses the person may see.
 */
export function expenseWhere(sp: ExpenseSearch, accountIds: string[], today = nepalToday(), scope?: ExpenseScope) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const range = resolvePeriod(sp, today);
  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const limited = scopeCondition(scope, push);
  if (limited) conditions.push(limited);

  if (range.from) conditions.push(`e.expense_date >= ${push(range.from)}`);
  if (range.to) conditions.push(`e.expense_date <= ${push(range.to)}`);
  if (sp.cat) conditions.push(`e.category_id = ${push(sp.cat)}`);
  if (sp.vendor) conditions.push(`e.vendor_id = ${push(sp.vendor)}`);
  if (sp.client) conditions.push(`lower(btrim(e.client)) = lower(btrim(${push(sp.client)}))`);
  if (sp.ledger === "founder") conditions.push(`e.funding_source <> 'company_funds'`);
  else if (sp.ledger === "company") conditions.push(`e.funding_source = 'company_funds'`);
  else if (sp.ledger?.startsWith("account:")) {
    const id = sp.ledger.slice("account:".length);
    if (accountIds.includes(id)) {
      conditions.push(`e.funding_source = 'company_funds'`);
      conditions.push(`e.money_account_id = ${push(id)}`);
    }
  }
  const needle = sp.q?.trim();
  if (needle) {
    const like = push(`%${needle.replace(/[%_\\]/g, (match) => `\\${match}`)}%`);
    conditions.push(`(e.note ilike ${like} or e.client ilike ${like} or v.name ilike ${like} or c.name ilike ${like})`);
  }

  return { where: conditions.length ? `where ${conditions.join(" and ")}` : "", params, range };
}

/** Rebuild a query string from the current filters with some keys changed. */
export function withFilters(sp: ExpenseSearch, changes: Partial<Record<keyof ExpenseSearch, string | null>>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...sp, ...changes })) {
    if (value != null && value !== "") next.set(key, String(value));
  }
  const text = next.toString();
  return text ? `?${text}` : "";
}
