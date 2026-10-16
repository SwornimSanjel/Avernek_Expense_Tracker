"use client";

import Icon from "@/components/Icons";
import { MonthPicker } from "@/components/controls";
import { monthLabel, monthRange, shiftMonth } from "@/lib/dates";

export type PeriodMode = "month" | "last" | "year" | "all" | "custom";

/** A period as the Statement shows it: one month, a preset, or a custom range. */
export type Period = { mode: PeriodMode; monthKey: string; from: string; to: string };

/** Starts on this month; the custom range starts on it too. */
export function initialPeriod(today: string, mode: PeriodMode = "month"): Period {
  const thisMonth = today.slice(0, 7);
  return { mode, monthKey: thisMonth, from: monthRange(thisMonth).from, to: today };
}

/** The dates a period covers. `firstDate` is the earliest record, for "All time". */
export function periodRange(period: Period, today: string, firstDate: string): { from: string; to: string } {
  const thisMonth = today.slice(0, 7);
  if (period.mode === "month") return monthRange(period.monthKey);
  if (period.mode === "last") return monthRange(shiftMonth(thisMonth, -1));
  if (period.mode === "year") return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  if (period.mode === "all") return { from: firstDate < today ? firstDate : today, to: today > firstDate ? today : firstDate };
  return { from: period.from || firstDate, to: period.to || today };
}

/** "October 2026", "All time", "2026-08-01 → 2026-09-30". */
export function describePeriod(period: Period, today: string, range: { from: string; to: string }): string {
  if (period.mode === "month") return monthLabel(period.monthKey);
  if (period.mode === "last") return monthLabel(shiftMonth(today.slice(0, 7), -1));
  if (period.mode === "year") return `Year ${today.slice(0, 4)}`;
  if (period.mode === "all") return "All time";
  return `${range.from} → ${range.to}`;
}

const PRESETS: [PeriodMode, string][] = [
  ["month", "This month"],
  ["last", "Last month"],
  ["year", "This year"],
  ["all", "All time"],
  ["custom", "Custom"],
];

/**
 * Period controls: step month by month, pick a month, a preset, or a custom
 * From–To range. Every change applies at once; there is no Apply button.
 */
export default function PeriodPicker({
  period,
  today,
  label,
  marked,
  onChange,
}: {
  period: Period;
  today: string;
  /** What the month button shows, from describePeriod. */
  label: string;
  /** Months with records, dotted in the month picker. */
  marked?: Set<string>;
  onChange: (next: Period) => void;
}) {
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const { mode, monthKey, from, to } = period;
  const showMonth = (key: string) => onChange({ ...period, mode: "month", monthKey: key });

  return (
    <>
      <div className="stmt-period">
        <button
          type="button"
          className="icon-btn !w-9 !h-9"
          aria-label="Previous month"
          onClick={() => showMonth(shiftMonth(mode === "month" ? monthKey : mode === "last" ? lastMonth : thisMonth, -1))}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <MonthPicker value={mode === "last" ? lastMonth : monthKey} maxKey={thisMonth} marked={marked} onChange={showMonth}>
          {label}
        </MonthPicker>
        <button
          type="button"
          className="icon-btn !w-9 !h-9"
          aria-label="Next month"
          disabled={mode === "month" && monthKey >= thisMonth}
          onClick={() => {
            const next = shiftMonth(mode === "month" ? monthKey : lastMonth, 1);
            showMonth(next > thisMonth ? thisMonth : next);
          }}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map(([value, text]) => {
          const on = value === "month" ? mode === "month" && monthKey === thisMonth : mode === value;
          return (
            <button
              key={value}
              type="button"
              className={`chip !h-8 ${on ? "chip-on" : ""}`}
              onClick={() => onChange({ ...period, mode: value, monthKey: value === "month" ? thisMonth : monthKey })}
            >
              {text}
            </button>
          );
        })}
      </div>

      {mode === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="date-field">
            From
            <input type="date" value={from} max={to || today} onChange={(event) => onChange({ ...period, from: event.target.value })} />
          </label>
          <label className="date-field">
            To
            <input type="date" value={to} min={from} onChange={(event) => onChange({ ...period, to: event.target.value })} />
          </label>
        </div>
      )}
    </>
  );
}
