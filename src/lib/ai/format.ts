import { npr, usd } from "@/lib/format";
import type { Currency } from "@/lib/types";

/** An amount in its currency, formatted as the rest of the app does. */
export function money(amount: number, currency: Currency | string = "NPR"): string {
  return currency === "USD" ? usd(amount) : npr(amount);
}

/** Per-currency totals as one line: "NPR 1,20,000 · USD 450.00". */
export function moneyByCurrency(totals: Map<string, number>, empty = "NPR 0"): string {
  const parts = [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => (a === "NPR" ? -1 : b === "NPR" ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => money(amount, currency));
  return parts.length ? parts.join(" · ") : empty;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function truncate(value: string | null | undefined, length = 48): string {
  const text = String(value ?? "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
