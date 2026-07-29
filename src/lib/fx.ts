/**
 * Foreign-exchange engine for Avernek.
 *
 * Golden rules (from the brief):
 *  - Report currency is NPR. Never add raw USD to raw NPR.
 *  - Historical expenses FREEZE their rate. A stored amount_npr never changes
 *    because today's rate moved.
 *  - Priority ladder for a real (paid) expense:
 *      1. actual NPR charged  -> conversion_status = 'exact',            fx_source = 'actual'
 *      2. NRB sell rate for the expense date -> 'official_estimate',     fx_source = 'nrb'
 *      3. manual rate the user typed         -> 'manual_estimate',       fx_source = 'manual'
 *      (planned/unknown)                     -> current NRB rate as est. fx_source = 'estimated'
 *      (nothing available)                   -> 'pending',               fx_source = 'pending'
 *  - We use the NRB SELLING rate (that's what you pay to buy USD).
 *  - This is an expense tracker, not a forex terminal. No charts, no live ticking.
 */

import { format, subDays, parseISO } from "date-fns";
import { exec, one } from "@/lib/db";

const NRB_BASE = "https://www.nrb.org.np/api/forex/v1";
const LOOKBACK_DAYS = 7; // window to search back for the most recent rate on/before a date

export interface UsdRate {
  rate: number; // NPR per 1 USD (sell)
  rateDate: string; // the date the rate actually belongs to (YYYY-MM-DD)
  buy: number | null;
  source: "nrb";
}

/** Shape of a cached fx_rates row. */
interface FxRateRow {
  rate_date: string;
  buy_rate: string | number | null;
  sell_rate: string | number | null;
}

// -----------------------------------------------------------------------------
// NRB API
// -----------------------------------------------------------------------------

/** Fetch USD buy/sell rows from NRB for an inclusive date range. Best-effort, defensive parse. */
export async function fetchNrbUsd(
  from: string,
  to: string
): Promise<{ date: string; buy: number | null; sell: number | null }[]> {
  // NB: NRB returns payload=null unless `page` is explicitly passed.
  const url = `${NRB_BASE}/rates?from=${from}&to=${to}&per_page=100&page=1`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Rates for a past date never change, so cache aggressively at the fetch layer.
    next: { revalidate: 60 * 60 },
  });
  if (!res.ok) throw new Error(`NRB API returned ${res.status}`);
  const json: any = await res.json();

  // The public NRB response nests the daily entries; shapes have varied over time,
  // so we probe the common locations.
  const raw = json?.data?.payload ?? json?.payload ?? [];
  const payload: any[] = Array.isArray(raw) ? raw : [];

  const out: { date: string; buy: number | null; sell: number | null }[] = [];
  for (const day of payload) {
    const date: string = day?.date ?? day?.rate_date ?? day?.published_on;
    const rates: any[] = day?.rates ?? [];
    const usd = rates.find(
      (r) =>
        (r?.currency?.iso3 ?? r?.iso3 ?? r?.currency)?.toString().toUpperCase() ===
        "USD"
    );
    if (!date || !usd) continue;
    const unit = Number(usd?.currency?.unit ?? usd?.unit ?? 1) || 1;
    const buy = num(usd?.buy);
    const sell = num(usd?.sell);
    out.push({
      date: date.slice(0, 10),
      buy: buy == null ? null : buy / unit,
      sell: sell == null ? null : sell / unit,
    });
  }
  return out;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------------
// Cache (fx_rates table). Historical rows are immutable: on conflict do nothing.
// -----------------------------------------------------------------------------

export async function cacheNrbUsd(
  rows: { date: string; buy: number | null; sell: number | null }[]
) {
  if (rows.length === 0) return;

  // One multi-row insert rather than a statement per row. `do nothing` keeps
  // the immutability rule: a historical rate already stored is never rewritten.
  const params: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 4;
    params.push(row.date, row.buy, row.sell, "nrb");
    return `($${offset + 1}, 'USD', 'NPR', $${offset + 2}, $${offset + 3}, $${offset + 4})`;
  });

  await exec(
    `insert into public.fx_rates
       (rate_date, base_currency, quote_currency, buy_rate, sell_rate, source)
     values ${tuples.join(", ")}
     on conflict (rate_date, base_currency, quote_currency) do nothing`,
    params
  );
}

async function cachedUsdOnOrBefore(date: string): Promise<UsdRate | null> {
  const floor = format(subDays(parseISO(date), LOOKBACK_DAYS), "yyyy-MM-dd");

  const row = await one<FxRateRow>(
    `select rate_date, buy_rate, sell_rate
       from public.fx_rates
      where base_currency = 'USD'
        and quote_currency = 'NPR'
        and rate_date <= $1
        and rate_date >= $2
        and sell_rate is not null
      order by rate_date desc
      limit 1`,
    [date, floor]
  );

  if (!row) return null;

  return {
    rate: Number(row.sell_rate),
    buy: row.buy_rate == null ? null : Number(row.buy_rate),
    rateDate: String(row.rate_date).slice(0, 10),
    source: "nrb",
  };
}

// -----------------------------------------------------------------------------
// Public: resolve the USD sell rate to use for a given expense date.
// Never returns a rate from AFTER the requested date. Freezes to the real rate date.
// -----------------------------------------------------------------------------

export async function getUsdSellRateForDate(
  date: string
): Promise<UsdRate | null> {
  // 1. Cache (fast, and immutable for the past).
  const cached = await cachedUsdOnOrBefore(date);
  if (cached) return cached;

  // 2. Ask NRB for a small window ENDING on the expense date, then cache + reselect.
  try {
    const from = format(subDays(parseISO(date), LOOKBACK_DAYS), "yyyy-MM-dd");
    const rows = await fetchNrbUsd(from, date);
    await cacheNrbUsd(rows);
    const usable = rows
      .filter((r) => r.sell != null && r.date <= date)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const best = usable[0];
    if (best) {
      return { rate: best.sell!, buy: best.buy, rateDate: best.date, source: "nrb" };
    }
  } catch {
    // NRB unreachable — fall through to null so the caller can go 'pending'.
  }
  return null;
}

/** Latest known USD sell rate (for "current rate" display and planned-expense estimates). */
export async function getCurrentUsdSellRate(): Promise<UsdRate | null> {
  const today = format(new Date(), "yyyy-MM-dd");
  return getUsdSellRateForDate(today);
}

/**
 * CACHE-ONLY current rate for dashboards: reads the newest cached row and never
 * calls NRB. Keeps page loads fast; the daily cron keeps the cache fresh.
 */
export async function getCachedUsdSellRate(): Promise<UsdRate | null> {
  const row = await one<FxRateRow>(
    `select rate_date, buy_rate, sell_rate
       from public.fx_rates
      where base_currency = 'USD'
        and quote_currency = 'NPR'
        and sell_rate is not null
      order by rate_date desc
      limit 1`
  );

  if (!row) return null;

  return {
    rate: Number(row.sell_rate),
    buy: row.buy_rate == null ? null : Number(row.buy_rate),
    rateDate: String(row.rate_date).slice(0, 10),
    source: "nrb",
  };
}

// -----------------------------------------------------------------------------
// Public: pure resolver — turns raw form input into the frozen conversion fields.
// -----------------------------------------------------------------------------

export interface ConversionInput {
  amount: number;
  currency: "NPR" | "USD";
  /** exact figure debited on the statement, if the user knows it */
  actualNprCharged?: number | null;
  /** NRB (or fallback) rate looked up for the expense date */
  nrbRate?: UsdRate | null;
  /** rate the user typed by hand */
  manualRate?: number | null;
  /** true for planned/future subscription expenses with no real figure yet */
  planned?: boolean;
}

export interface ConversionResult {
  amount_npr: number | null;
  fx_rate_to_npr: number;
  fx_rate_date: string | null;
  fx_source: "actual" | "nrb" | "manual" | "estimated" | "pending";
  conversion_status: "exact" | "official_estimate" | "manual_estimate" | "pending";
  actual_npr_charged: number | null;
}

export function resolveConversion(input: ConversionInput): ConversionResult {
  const { amount, currency } = input;

  // NPR expenses convert 1:1 and are always exact.
  if (currency === "NPR") {
    return {
      amount_npr: round2(amount),
      fx_rate_to_npr: 1,
      fx_rate_date: null,
      fx_source: "actual",
      conversion_status: "exact",
      actual_npr_charged: null,
    };
  }

  // --- USD ladder ---

  // Priority 1: the actual NPR charged is ground truth.
  if (input.actualNprCharged != null && input.actualNprCharged > 0 && amount > 0) {
    const effective = input.actualNprCharged / amount;
    return {
      amount_npr: round2(input.actualNprCharged),
      fx_rate_to_npr: round6(effective),
      fx_rate_date: null,
      fx_source: "actual",
      conversion_status: "exact",
      actual_npr_charged: round2(input.actualNprCharged),
    };
  }

  // Planned/future expense: current rate as a labelled estimate only.
  if (input.planned && input.nrbRate) {
    return {
      amount_npr: round2(amount * input.nrbRate.rate),
      fx_rate_to_npr: round6(input.nrbRate.rate),
      fx_rate_date: input.nrbRate.rateDate,
      fx_source: "estimated",
      conversion_status: "official_estimate",
      actual_npr_charged: null,
    };
  }

  // Priority 2: historical NRB sell rate for the expense date.
  if (input.nrbRate) {
    return {
      amount_npr: round2(amount * input.nrbRate.rate),
      fx_rate_to_npr: round6(input.nrbRate.rate),
      fx_rate_date: input.nrbRate.rateDate,
      fx_source: "nrb",
      conversion_status: "official_estimate",
      actual_npr_charged: null,
    };
  }

  // Priority 3: a manual rate the user typed.
  if (input.manualRate != null && input.manualRate > 0) {
    return {
      amount_npr: round2(amount * input.manualRate),
      fx_rate_to_npr: round6(input.manualRate),
      fx_rate_date: null,
      fx_source: "manual",
      conversion_status: "manual_estimate",
      actual_npr_charged: null,
    };
  }

  // Nothing available — save as pending, do not block creation.
  return {
    amount_npr: null,
    fx_rate_to_npr: 1,
    fx_rate_date: null,
    fx_source: "pending",
    conversion_status: "pending",
    actual_npr_charged: null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
