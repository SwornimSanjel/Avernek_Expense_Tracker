"use client";

import { useMemo, useState } from "react";
import BulkSelect, { SelectBox, SelectGroup, SelectToggle } from "@/components/BulkSelect";
import PeriodPicker, { describePeriod, initialPeriod, periodRange, type Period } from "@/components/PeriodPicker";
import type { BulkResult } from "@/lib/bulk";
import { monthLabel } from "@/lib/dates";
import { formatNumber } from "@/lib/format";

export type BillItem = {
  id: string;
  date: string;
  total: number;
  /** VAT printed on the bill (paid). */
  vat: number;
  /** The part claimed from IRD. */
  claimed: number;
  pending: number;
  /** The bill's row, rendered on the server with its actions. */
  content: React.ReactNode;
};

/**
 * Bills in Avernek's name, newest first and grouped by month, with the
 * Statement's period controls: a month, This month / Last month / This year /
 * All time, or a custom range. Starts on All time.
 */
export default function BillsByMonth({
  items,
  today,
  onDelete,
  locked,
}: {
  items: BillItem[];
  today: string;
  /** "Select" → delete several; only for those allowed to delete. */
  onDelete?: (ids: string[]) => Promise<BulkResult>;
  /** Bills that cannot be deleted, with why. */
  locked?: Record<string, string>;
}) {
  const [period, setPeriod] = useState<Period>(() => initialPeriod(today, "all"));
  const firstDate = items.length ? items[items.length - 1].date : today;
  const range = periodRange(period, today, firstDate);
  const label = describePeriod(period, today, range);
  const marked = useMemo(() => new Set(items.map((item) => item.date.slice(0, 7))), [items]);

  // All time shows every bill, even one dated after today.
  const visible = period.mode === "all" ? items : items.filter((item) => item.date >= range.from && item.date <= range.to);
  const months = [...new Set(visible.map((item) => item.date.slice(0, 7)))];
  const sum = (list: BillItem[], pick: (item: BillItem) => number) => list.reduce((total, item) => total + pick(item), 0);
  const count = (n: number) => `${n} ${n === 1 ? "bill" : "bills"}`;

  return (
    <BulkSelect ids={visible.map((item) => item.id)} locked={locked} noun={{ one: "bill", many: "bills" }} onDelete={onDelete}>
      <div className="stmt-toolbar">
        <PeriodPicker period={period} today={today} label={label} marked={marked} onChange={setPeriod} />
        <SelectToggle className="ml-auto" />
      </div>

      {visible.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="text-[15px] font-semibold">No bills in {label}</div>
          <p className="text-[13.5px] muted mt-1">Pick another month or All time.</p>
        </div>
      ) : (
        <>
          <div className="bills-summary">
            <span>{count(visible.length)}</span>
            <span>
              Total <strong className="tnum">{formatNumber(sum(visible, (item) => item.total))}</strong>
            </span>
            <span>
              VAT in bills <strong className="tnum text-amber">{formatNumber(sum(visible, (item) => item.vat))}</strong>
            </span>
            <span>
              VAT claimed <strong className="tnum text-green">{formatNumber(sum(visible, (item) => item.claimed))}</strong>
            </span>
            {sum(visible, (item) => item.pending) > 0 && (
              <span>
                To reimburse <strong className="tnum">{formatNumber(sum(visible, (item) => item.pending))}</strong>
              </span>
            )}
          </div>
          {months.map((key) => {
            const rows = visible.filter((item) => item.date.startsWith(key));
            return (
              <section key={key}>
                <div className="bills-month">
                  <div>
                    <SelectGroup ids={rows.map((item) => item.id)} label={monthLabel(key)} />
                    <span className="font-semibold">{monthLabel(key)}</span>
                    <span className="muted"> · {count(rows.length)}</span>
                  </div>
                  <div className="bills-month-figures">
                    <span>
                      <span className="muted">Total</span> <strong className="tnum">{formatNumber(sum(rows, (item) => item.total))}</strong>
                    </span>
                    <span>
                      <span className="muted">VAT</span> <strong className="tnum text-amber">{formatNumber(sum(rows, (item) => item.vat))}</strong>
                    </span>
                    <span>
                      <span className="muted">Claimed</span> <strong className="tnum text-green">{formatNumber(sum(rows, (item) => item.claimed))}</strong>
                    </span>
                  </div>
                </div>
                <div className="row-list">
                  {rows.map((item) => (
                    <div key={item.id} className="bulk-row">
                      <SelectBox id={item.id} />
                      <div>{item.content}</div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </BulkSelect>
  );
}
