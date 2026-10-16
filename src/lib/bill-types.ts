/**
 * Bill types are the app's expense categories, shown with friendlier names on
 * the Bills page. Client-safe.
 */

const LABELS: Record<string, string> = {
  "AI / Token Usage": "AI subscriptions",
  "Office Supplies": "Stationery & office",
  "Professional fees": "Lawyer & professional",
  "Software / SaaS": "Software",
  "Phone / Recharge": "Phone & recharge",
  "Company Registration": "Registration & government",
};

export function billTypeLabel(name: string | null | undefined): string {
  if (!name) return "No type yet";
  return LABELS[name] ?? name;
}

/** Order on the Bills page: the everyday ones first. */
export const BILL_TYPE_ORDER = [
  "Food",
  "Drinks & smoke",
  "Office Supplies",
  "AI / Token Usage",
  "Software / SaaS",
  "Professional fees",
  "Travel",
  "Phone / Recharge",
  "Company Registration",
  "Sales Meeting",
  "Ad Spend",
  "Miscellaneous",
];

/**
 * Whether a bill's VAT is claimed from IRD by default. VAT on food and drinks
 * usually cannot be claimed; on business purchases (stationery, a lawyer, a
 * software bill with a Nepali VAT invoice) it usually can. Always editable.
 */
export function claimVatByDefault(categoryName: string | null | undefined): boolean {
  if (!categoryName) return false;
  return !["Food", "Drinks & smoke", "Sales Meeting", "Miscellaneous"].includes(categoryName);
}

export type BillCategory = { id: string; name: string; color: string; counts_as_expense: boolean };

export function sortBillCategories<T extends { name: string }>(categories: T[]): T[] {
  const rank = (name: string) => {
    const index = BILL_TYPE_ORDER.indexOf(name);
    return index === -1 ? BILL_TYPE_ORDER.length : index;
  };
  return [...categories].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}
