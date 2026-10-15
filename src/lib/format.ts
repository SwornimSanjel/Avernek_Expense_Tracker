import type { ConversionStatus, FxSource } from "./types";

/**
 * One money format for the whole workspace. Rupees use Nepali grouping
 * (1,10,433.38), dollars use international grouping. Paisa only when present.
 * Before this, two formatters disagreed on the same page (1,10,433 vs 170,540).
 */
export function formatNumber(amount: number, currency = "NPR"): string {
  const hasFraction = Math.round(Math.abs(amount) * 100) % 100 !== 0;
  return amount.toLocaleString(currency === "USD" ? "en-US" : "en-IN", {
    minimumFractionDigits: currency === "USD" || hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function formatMoney(amount: number | null | undefined, currency = "NPR"): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return `${currency} ${formatNumber(amount, currency)}`;
}

/** NPR 12,450 — grouped, no decimals for whole rupees, 2dp otherwise. */
export function npr(amount: number | null | undefined): string {
  return formatMoney(amount == null ? null : Number(amount), "NPR");
}

/** USD 20.00 */
export function usd(amount: number | null | undefined): string {
  return formatMoney(amount == null ? null : Number(amount), "USD");
}

/** 2.0L / 76k / 950 — for chart axes and tight spots. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_00_00_000) return `${sign}${(abs / 1_00_00_000).toFixed(abs >= 10_00_00_000 ? 0 : 1)}Cr`;
  if (abs >= 1_00_000) return `${sign}${(abs / 1_00_000).toFixed(abs >= 10_00_000 ? 0 : 1)}L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function compactMoney(value: number, currency = "NPR"): string {
  return `${currency} ${compactNumber(value)}`;
}

/** +12% / −4% — change between two periods; null when there is no base. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** A rate like "NPR 152.83/USD". */
export function rateLabel(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `NPR ${rate.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}/USD`;
}

/** Small human labels for the FX source, per the brief's restrained-label rule. */
export function fxSourceLabel(source: FxSource): string {
  switch (source) {
    case "actual":
      return "Actual";
    case "nrb":
      return "NRB rate";
    case "manual":
      return "Manual";
    case "estimated":
      return "Estimated";
    case "pending":
      return "Rate pending";
  }
}

/** Is this figure a confirmed number or an estimate? Drives visual distinction. */
export function isEstimate(status: ConversionStatus): boolean {
  return status !== "exact";
}
