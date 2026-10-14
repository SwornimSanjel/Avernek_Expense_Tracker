import type { ConversionStatus, FxSource } from "./types";

/** NPR 12,450 — grouped, no decimals for whole rupees, 2dp otherwise. */
export function npr(amount: number | null | undefined): string {
  if (amount == null) return "—";
  const hasPaisa = Math.round(amount * 100) % 100 !== 0;
  return (
    "NPR " +
    amount.toLocaleString("en-IN", {
      minimumFractionDigits: hasPaisa ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

/** USD 20.00 */
export function usd(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return (
    "USD " +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
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
