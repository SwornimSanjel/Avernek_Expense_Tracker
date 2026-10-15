import { isValidDate } from "@/lib/income";

/**
 * Calendar-date helpers for the assistant. Dates are the app's YYYY-MM-DD
 * strings; arithmetic is done in UTC so no time zone or daylight-saving rule
 * can add or lose a day.
 */

export { isValidDate };

function utc(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return iso(utc(date) + days * 86_400_000);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

// "en" month names ("Sep", as on the app's pages; en-GB writes "Sept"),
// assembled day-first.
const PARTS = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function parts(date: string) {
  return Object.fromEntries(PARTS.formatToParts(new Date(utc(date))).map((part) => [part.type, part.value]));
}

/** "2026-10-14" → "14 Oct 2026". */
export function formatDate(date: string | null | undefined): string {
  if (!date || !isValidDate(date)) return "—";
  const p = parts(date);
  return `${p.day} ${p.month} ${p.year}`;
}

/** "2026-10" or "2026-10-01" → "Oct 2026". */
export function formatMonth(value: string): string {
  const date = value.length === 7 ? `${value}-01` : value;
  if (!isValidDate(date)) return value;
  const p = parts(date);
  return `${p.month} ${p.year}`;
}

export function formatRange(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/** 430 → "430 days (about 1 year 2 months)". */
export function durationLabel(days: number): string {
  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  const base = `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return base;
  const months = Math.floor(days / 30.4375);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years ? `${years} year${years === 1 ? "" : "s"}` : "",
    rest ? `${rest} month${rest === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${base} (about ${parts.join(" ")})`;
}

/** First day of the month of `date`, and of the following month. */
export function monthBounds(date: string): { from: string; before: string } {
  const [year, month] = date.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from: `${date.slice(0, 7)}-01`, before: next };
}
