import NepaliDate from "nepali-date-converter";

/**
 * Nepali (Bikram Sambat) dates for tax deadlines. IRD works in Nepali months:
 * a VAT or TDS return for a month is due by the 25th of the next one, and the
 * fiscal year runs Shrawan 1 to the end of Ashadh. The app keeps AD dates
 * (YYYY-MM-DD) everywhere; these helpers convert at the edges.
 *
 * A month is keyed "2083-06" (Ashwin 2083); months are 1-based.
 */

export const BS_MONTHS = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export type BsDate = { year: number; month: number; day: number };

const pad = (n: number) => String(n).padStart(2, "0");

function isoOf(year: number, monthIndex: number, day: number) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** An AD date as a Nepali date. */
export function toBs(iso: string): BsDate {
  const [year, month, day] = iso.split("-").map(Number);
  const bs = NepaliDate.fromAD(new Date(year, month - 1, day)).getBS();
  return { year: bs.year, month: bs.month + 1, day: bs.date };
}

/** A Nepali date as an AD date. */
export function fromBs(year: number, month: number, day: number): string {
  const ad = new NepaliDate(year, month - 1, day).getAD();
  return isoOf(ad.year, ad.month, ad.date);
}

export function bsMonthKey(iso: string): string {
  const bs = toBs(iso);
  return `${bs.year}-${pad(bs.month)}`;
}

function parseKey(key: string) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

export function shiftBsMonth(key: string, by: number): string {
  const { year, month } = parseKey(key);
  const index = year * 12 + (month - 1) + by;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** First and last AD day of a Nepali month. */
export function bsMonthRange(key: string): { from: string; to: string } {
  const { year, month } = parseKey(key);
  const next = parseKey(shiftBsMonth(key, 1));
  const from = fromBs(year, month, 1);
  const nextStart = fromBs(next.year, next.month, 1);
  const end = new Date(`${nextStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, to: end.toISOString().slice(0, 10) };
}

/** "Ashwin 2083". */
export function bsMonthLabel(key: string): string {
  const { year, month } = parseKey(key);
  return `${BS_MONTHS[month - 1]} ${year}`;
}

/** "Kartik 25, 2083". */
export function formatBs(iso: string): string {
  const bs = toBs(iso);
  return `${BS_MONTHS[bs.month - 1]} ${bs.day}, ${bs.year}`;
}

/** The 25th of the month after `key`: when that month's VAT and TDS are due. */
export function returnDueDate(key: string): string {
  const next = parseKey(shiftBsMonth(key, 1));
  return fromBs(next.year, next.month, 25);
}

/** The last AD day of a Nepali month (e.g. Poush end). */
export function bsMonthEnd(year: number, month: number): string {
  return bsMonthRange(`${year}-${pad(month)}`).to;
}

/** The fiscal year a date falls in: "2083/84" runs Shrawan 1, 2083 to Ashadh end, 2084. */
export function fiscalYearOf(iso: string): { label: string; start: number } {
  const bs = toBs(iso);
  const start = bs.month >= 4 ? bs.year : bs.year - 1;
  return { label: `${start}/${pad((start + 1) % 100)}`, start };
}
