/**
 * Exact money arithmetic, in paisa (1/100 of a rupee or cent of a dollar).
 *
 * Amounts reach the app as Postgres `numeric` strings ("1234.50" — `pg` has no
 * parser registered for numeric, whatever lib/types.ts declares) or as form
 * numbers. Adding them as JavaScript floats drifts: 0.1 + 0.2 !== 0.3, and a
 * year of expenses can be a paisa off. Totals are summed here as integers and
 * converted back once, so the dashboard and the AI assistant, which share
 * these functions, always print the same figure.
 *
 * Integers stay exact up to Number.MAX_SAFE_INTEGER paisa (about NPR 90
 * trillion), far beyond anything this ledger holds.
 */

/** A whole number of paisa. */
export type Paisa = number;

const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * One amount in paisa. Blank and null count as zero (a missing VAT is no VAT);
 * anything else that is not a number throws, so a corrupt value can never be
 * summed silently as zero. Half a paisa rounds away from zero.
 */
export function toPaisa(value: number | string | null | undefined): Paisa {
  if (value == null) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    // String(1.005) is "1.005": parsing the shortest decimal form rounds the
    // way a person would, where 1.005 * 100 gives 100.49999… and rounds down.
    const text = String(value);
    if (DECIMAL.test(text)) return fromDecimalString(text);
    return Math.round(value * 100); // exponent notation: tiny or huge values
  }
  const text = value.trim();
  if (text === "") return 0;
  if (!DECIMAL.test(text) || text === "." || text === "-" || text === "+") {
    throw new Error(`Invalid amount: ${JSON.stringify(value)}`);
  }
  return fromDecimalString(text);
}

function fromDecimalString(text: string): Paisa {
  const [, sign, whole = "", fraction = ""] = DECIMAL.exec(text)!;
  const digits = (fraction + "000").slice(0, 3);
  let paisa = Number(whole || "0") * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) paisa += 1;
  if (!Number.isSafeInteger(paisa)) throw new Error(`Amount out of range: ${text}`);
  return sign === "-" && paisa !== 0 ? -paisa : paisa;
}

/** Paisa back to a rupee/dollar number, for display and JSON. */
export function fromPaisa(paisa: Paisa): number {
  return paisa / 100;
}

/** The exact sum, in paisa. */
export function sumPaisa(values: Iterable<number | string | null | undefined>): Paisa {
  let total = 0;
  for (const value of values) total += toPaisa(value);
  return total;
}

/** The exact sum, as an amount. */
export function sumMoney(values: Iterable<number | string | null | undefined>): number {
  return fromPaisa(sumPaisa(values));
}

/** amount × rate, rounded once to the paisa (e.g. USD × NPR rate). */
export function multiplyToPaisa(amount: number | string, rate: number): Paisa {
  return Math.round(toPaisa(amount) * rate);
}
