/**
 * What a signed-in person may view.
 *
 * Administrators see everything. Anyone else sees what users.access allows:
 * null means everything (how every account worked before access existed);
 * otherwise a list of pages and the kinds of expenses they may see.
 *
 * Expenses are split three ways, by where the money came from:
 *   vat      — the VAT account (money_accounts.kind = 'company_bank')
 *   non_vat  — the personal / non-VAT company accounts (every other kind)
 *   founder  — paid by a partner personally (expenses.funding_source <> 'company_funds')
 *
 * Some pages add up expenses from every account (Overview, Statement,
 * Company money…). Showing one of them to someone limited to the VAT account
 * would show the rest anyway, so those pages open only for people who may see
 * every kind of expense.
 */

export const EXPENSE_LEDGERS = ["vat", "non_vat", "founder"] as const;
export type ExpenseLedger = (typeof EXPENSE_LEDGERS)[number];

export const LEDGER_LABELS: Record<ExpenseLedger, { label: string; hint: string }> = {
  vat: { label: "VAT account", hint: "Paid from the company VAT account" },
  non_vat: { label: "Personal (non-VAT) account", hint: "Paid from the non-VAT company money" },
  founder: { label: "Founder money", hint: "Paid by a partner personally" },
};

export type SectionKey =
  | "overview"
  | "statement"
  | "income"
  | "other_income"
  | "funds"
  | "loans"
  | "subscriptions"
  | "vat"
  | "bills"
  | "clients"
  | "settlements";

export const SECTIONS: { key: SectionKey; label: string; href: string; allExpenses: boolean }[] = [
  { key: "overview", label: "Overview", href: "/", allExpenses: true },
  { key: "statement", label: "Statement", href: "/statement", allExpenses: true },
  { key: "income", label: "Income", href: "/income", allExpenses: false },
  { key: "other_income", label: "Other income", href: "/other-income", allExpenses: false },
  { key: "funds", label: "Company money", href: "/funds", allExpenses: true },
  { key: "loans", label: "Loans", href: "/loans", allExpenses: false },
  { key: "subscriptions", label: "Subscriptions", href: "/subscriptions", allExpenses: true },
  { key: "vat", label: "VAT & TDS", href: "/vat", allExpenses: true },
  { key: "bills", label: "Bills", href: "/bills", allExpenses: true },
  { key: "clients", label: "Clients", href: "/clients", allExpenses: true },
  { key: "settlements", label: "Contributions", href: "/settlements", allExpenses: true },
];

const SECTION_KEYS = new Set<string>(SECTIONS.map((section) => section.key));
const LEDGER_KEYS = new Set<string>(EXPENSE_LEDGERS);

export type Access = {
  /** Administrators, and people with no limits set. */
  full: boolean;
  sections: SectionKey[];
  expenses: ExpenseLedger[];
};

export const FULL_ACCESS: Access = {
  full: true,
  sections: SECTIONS.map((section) => section.key),
  expenses: [...EXPENSE_LEDGERS],
};

/** users.access → Access. Unknown keys are dropped; anything malformed means no access. */
export function resolveAccess(row: { is_admin: boolean; access: unknown }): Access {
  if (row.is_admin || row.access == null) return FULL_ACCESS;
  const stored = (typeof row.access === "object" ? row.access : {}) as { sections?: unknown; expenses?: unknown };
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  return {
    full: false,
    sections: list(stored.sections).filter((key): key is SectionKey => SECTION_KEYS.has(key)),
    expenses: list(stored.expenses).filter((key): key is ExpenseLedger => LEDGER_KEYS.has(key)),
  };
}

/** What to store in users.access; null when nothing is limited. */
export function storedAccess(sections: SectionKey[], expenses: ExpenseLedger[]): { sections: SectionKey[]; expenses: ExpenseLedger[] } | null {
  const pages = SECTIONS.map((section) => section.key).filter((key) => sections.includes(key));
  const ledgers = EXPENSE_LEDGERS.filter((key) => expenses.includes(key));
  if (pages.length === SECTIONS.length && ledgers.length === EXPENSE_LEDGERS.length) return null;
  return { sections: pages, expenses: ledgers };
}

export function seesAllExpenses(access: Access): boolean {
  return access.full || EXPENSE_LEDGERS.every((ledger) => access.expenses.includes(ledger));
}

export function canViewExpenses(access: Access): boolean {
  return access.full || access.expenses.length > 0;
}

export function canView(access: Access, key: SectionKey): boolean {
  if (access.full) return true;
  const section = SECTIONS.find((item) => item.key === key);
  if (!section || !access.sections.includes(key)) return false;
  return !section.allExpenses || seesAllExpenses(access);
}

/**
 * Everything, with nothing held back. The assistant can read every table,
 * so it is only offered to people who could see all of it anyway.
 */
export function hasEverything(access: Access): boolean {
  return access.full || (seesAllExpenses(access) && SECTIONS.every((section) => access.sections.includes(section.key)));
}

/** Where to send someone who opened a page they cannot view. */
export function firstAllowedHref(access: Access): string {
  // Sidebar order: Expenses sits between Statement and Income.
  const pages = [
    ...SECTIONS.slice(0, 2).map((section) => ({ href: section.href, ok: canView(access, section.key) })),
    { href: "/expenses", ok: canViewExpenses(access) },
    ...SECTIONS.slice(2).map((section) => ({ href: section.href, ok: canView(access, section.key) })),
  ];
  return pages.find((page) => page.ok)?.href ?? "/settings";
}

/** Which expense kind a row belongs to. `vatAccountIds` are the company_bank accounts. */
export function ledgerOf(
  expense: { funding_source: string; money_account_id: string | null },
  vatAccountIds: ReadonlySet<string>
): ExpenseLedger {
  if (expense.funding_source !== "company_funds") return "founder";
  return expense.money_account_id && vatAccountIds.has(expense.money_account_id) ? "vat" : "non_vat";
}

/** A short line for the Team table: "Everything", "Expenses: VAT account · Income". */
export function describeAccess(access: Access): string {
  if (access.full) return "Everything";
  const parts: string[] = [];
  if (access.expenses.length === EXPENSE_LEDGERS.length) parts.push("All expenses");
  else if (access.expenses.length) parts.push(`Expenses: ${access.expenses.map((key) => LEDGER_LABELS[key].label).join(" + ")}`);
  for (const section of SECTIONS) if (canView(access, section.key)) parts.push(section.label);
  return parts.length ? parts.join(" · ") : "Nothing yet";
}
