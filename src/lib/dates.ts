/**
 * Calendar helpers in Nepal time.
 *
 * The server runs in UTC, so "today" taken from the server clock is still
 * yesterday until 05:45 in Kathmandu. Every "today", "this month" and default
 * date in the app comes from here instead, so the system always reads the real
 * day without anyone typing it. All values are plain YYYY-MM-DD strings, the
 * same shape every stored date has, so comparisons stay string-to-string.
 */

export const NEPAL_TZ = "Asia/Kathmandu";

function partsIn(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: Number(get("hour")) };
}

/** Today in Kathmandu as YYYY-MM-DD. */
export function nepalToday(now = new Date()): string {
  const { year, month, day } = partsIn(NEPAL_TZ, now);
  return `${year}-${month}-${day}`;
}

export function nepalHour(now = new Date()): number {
  return partsIn(NEPAL_TZ, now).hour;
}

/** "YYYY-MM" for a date string. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

export function currentMonthKey(): string {
  return monthKeyOf(nepalToday());
}

/** Shift a YYYY-MM key by whole months. */
export function shiftMonth(key: string, by: number): string {
  const [year, month] = key.split("-").map(Number);
  const index = year * 12 + (month - 1) + by;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/** Real calendar length: 28, 29, 30 or 31. */
export function daysInMonth(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First and last day (inclusive) of a YYYY-MM month. */
export function monthRange(key: string): { from: string; to: string } {
  return { from: `${key}-01`, to: `${key}-${String(daysInMonth(key)).padStart(2, "0")}` };
}

export function monthLabel(key: string, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat("en", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}-01T00:00:00Z`));
}

export function monthName(key: string, style: "long" | "short" = "short"): string {
  return new Intl.DateTimeFormat("en", { month: style, timeZone: "UTC" }).format(
    new Date(`${key}-01T00:00:00Z`)
  );
}

/** "15 Oct 2026" */
export function shortDate(date: string | null | undefined, fallback = "—"): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return fallback;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

/** "Thu, 15 Oct" */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

/** "Thursday, 15 October 2026" */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

export function greeting(now = new Date()): string {
  const hour = nepalHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Inclusive date-range test on YYYY-MM-DD strings. Empty bounds are open. */
export function inRange(date: string, from?: string | null, to?: string | null): boolean {
  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
