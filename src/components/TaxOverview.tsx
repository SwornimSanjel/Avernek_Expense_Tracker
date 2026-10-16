"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";
import Icon, { type IconName } from "./Icons";

/**
 * VAT at a glance: four boxes (collected, paid on bills, deductible, to pay),
 * each opening its details underneath, then the deadlines to keep. Every
 * figure arrives computed and formatted from the server.
 */

export type VatPeriodView = {
  key: string;
  label: string;
  range: string;
  collected: number;
  deductible: number;
  carriedIn: number;
  payable: number;
  paid: number;
  dueBs: string;
  dueAd: string;
  status: "open" | "due" | "late" | "filed";
};

export type DeadlineView = {
  key: string;
  kind: "vat" | "tds" | "advance" | "annual";
  title: string;
  detail: string;
  dueBs: string;
  dueAd: string;
  daysLeft: number;
  late: boolean;
  amount?: number;
};

type Box = "collected" | "bills" | "deductible" | "owed";

export default function TaxOverview({
  collected,
  paidOnBills,
  deductible,
  deposited,
  owed,
  carryForward,
  receipts,
  vatBills,
  periods,
  deadlines,
  firstMonth,
}: {
  collected: number;
  paidOnBills: number;
  deductible: number;
  deposited: number;
  owed: number;
  carryForward: number;
  receipts: { id: string; date: string; who: string; what: string; vat: number }[];
  vatBills: { id: string; date: string; shop: string; vat: number; claimed: boolean }[];
  periods: VatPeriodView[];
  deadlines: DeadlineView[];
  firstMonth: string;
}) {
  const [open, setOpen] = useState<Box | null>(null);
  const [guide, setGuide] = useState(false);
  const claimedBills = vatBills.filter((bill) => bill.claimed);

  const boxes: { key: Box; icon: IconName; tone: string; label: string; value: number; sub: string }[] = [
    {
      key: "collected",
      icon: "income",
      tone: "green",
      label: "VAT collected from clients",
      value: collected,
      sub: `${receipts.length} receipt${receipts.length === 1 ? "" : "s"} · 13% on top of our charges`,
    },
    {
      key: "bills",
      icon: "receipt",
      tone: "amber",
      label: "VAT we paid on bills",
      value: paidOnBills,
      sub: `${vatBills.length} bill${vatBills.length === 1 ? "" : "s"} with VAT`,
    },
    {
      key: "deductible",
      icon: "check",
      tone: "blue",
      label: "VAT we can deduct",
      value: deductible,
      sub: `${claimedBills.length} bill${claimedBills.length === 1 ? "" : "s"} marked to claim`,
    },
    {
      key: "owed",
      icon: "bank",
      tone: "accent",
      label: "VAT to pay the government",
      value: owed,
      sub: carryForward > 0 ? `NPR ${formatNumber(carryForward)} credit carried forward` : deposited > 0 ? `After NPR ${formatNumber(deposited)} already paid` : "Collected − deductible − already paid",
    },
  ];
  const late = deadlines.filter((deadline) => deadline.late);

  return (
    <section className="tax-overview rise">
      <div className="tax-boxes">
        {boxes.map((box) => (
          <button
            key={box.key}
            type="button"
            className={`tax-box tone-${box.tone} ${open === box.key ? "tax-box-on" : ""}`}
            onClick={() => setOpen((current) => (current === box.key ? null : box.key))}
            aria-expanded={open === box.key}
          >
            <span className="tax-box-head">
              <span className="tax-box-icon">
                <Icon name={box.icon} size={17} />
              </span>
              <Icon name="chevronDown" size={16} className="tax-box-chevron" />
            </span>
            <span className="tax-box-label">{box.label}</span>
            <span className="tax-box-value">
              <small>NPR</small> {formatNumber(box.value)}
            </span>
            <span className="tax-box-sub">{box.sub}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="tax-detail" key={open}>
          {open === "collected" && (
            <>
              <DetailHead title="VAT collected from clients" note="13% added on top of what clients pay. It is not our money: it goes to IRD." />
              {receipts.length === 0 ? (
                <Empty text="No payment with VAT recorded yet." />
              ) : (
                <Rows
                  head={["Date", "From", "VAT"]}
                  numeric={[2]}
                  rows={receipts.map((row) => [row.date, <Two key="w" main={row.who} sub={row.what} />, formatNumber(row.vat)])}
                  total={["Total", "", formatNumber(collected)]}
                />
              )}
            </>
          )}
          {open === "bills" && (
            <>
              <DetailHead title="VAT we paid on bills" note="VAT printed on bills in Avernek's name. We paid it, but only VAT that can be claimed lowers what we owe." />
              {vatBills.length === 0 ? (
                <Empty text="No bill with VAT yet." />
              ) : (
                <Rows
                  head={["Date", "Shop", "VAT", ""]}
                  numeric={[2]}
                  rows={vatBills.map((bill) => [
                    bill.date,
                    bill.shop,
                    formatNumber(bill.vat),
                    bill.claimed ? <span key="c" className="pill ok">Claimed</span> : <span key="c" className="pill">Not claimed</span>,
                  ])}
                  total={["Total", "", formatNumber(paidOnBills), ""]}
                />
              )}
            </>
          )}
          {open === "deductible" && (
            <>
              <DetailHead
                title="VAT we can deduct"
                note="Bills whose VAT is claimed from IRD (a lawyer's VAT invoice, for example). VAT on food and drinks usually cannot be claimed. Mark a bill with Edit → “Claim this VAT from IRD”."
              />
              {claimedBills.length === 0 ? (
                <Empty text="No bill is marked to claim yet." />
              ) : (
                <Rows
                  head={["Date", "Shop", "VAT claimed"]}
                  numeric={[2]}
                  rows={claimedBills.map((bill) => [bill.date, bill.shop, formatNumber(bill.vat)])}
                  total={["Total", "", formatNumber(deductible)]}
                />
              )}
            </>
          )}
          {open === "owed" && (
            <>
              <DetailHead
                title="VAT to pay the government"
                note={`A return for every Nepali month, filed and paid by the 25th of the next month, even with nothing to pay (a “nil” return). Months start from your first record (${firstMonth}); if Avernek was VAT-registered earlier, those months need nil returns too.`}
              />
              <div className="tax-equation">
                <span>
                  <small>Collected</small> {formatNumber(collected)}
                </span>
                <b>−</b>
                <span>
                  <small>Deductible</small> {formatNumber(deductible)}
                </span>
                <b>−</b>
                <span>
                  <small>Already paid</small> {formatNumber(deposited)}
                </span>
                <b>=</b>
                <span className="tax-equation-result">
                  <small>To pay</small> NPR {formatNumber(owed)}
                </span>
              </div>
              <Rows
                head={["Month", "Collected", "Deductible", "To pay", "Due by", "Status"]}
                numeric={[1, 2, 3]}
                rows={[...periods].reverse().map((period) => [
                  <Two key="m" main={period.label} sub={period.range} />,
                  formatNumber(period.collected),
                  formatNumber(period.deductible),
                  <Two key="p" main={formatNumber(period.payable)} sub={period.carriedIn > 0 ? `after ${formatNumber(period.carriedIn)} credit` : undefined} />,
                  <Two key="d" main={period.dueBs} sub={period.dueAd} />,
                  <Status key="s" status={period.status} nil={period.payable === 0} />,
                ])}
              />
            </>
          )}
        </div>
      )}

      <div className="tax-deadlines">
        <div className="tax-deadlines-head">
          <div>
            <h3>Deadlines</h3>
            <p>{late.length ? `${late.length} overdue: file these first.` : "What to file next, in Nepali dates."}</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setGuide((value) => !value)} aria-expanded={guide}>
            <Icon name="info" size={15} /> {guide ? "Hide guide" : "How to file & pay"}
          </button>
        </div>
        {guide && <Guide />}
        <div className="tax-deadline-list">
          {deadlines.slice(0, 6).map((deadline) => (
            <div key={deadline.key} className={`tax-deadline ${deadline.late ? "tax-deadline-late" : ""}`}>
              <span className={`tax-deadline-icon kind-${deadline.kind}`}>
                <Icon name={deadline.kind === "vat" ? "receipt" : deadline.kind === "tds" ? "users" : "bank"} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="tax-deadline-title">{deadline.title}</div>
                <div className="tax-deadline-detail">{deadline.detail}</div>
              </div>
              <div className="tax-deadline-when">
                <strong>{deadline.dueBs}</strong>
                <span>{deadline.dueAd}</span>
                <span className={`pill ${deadline.late ? "danger" : deadline.daysLeft <= 7 ? "warn" : ""}`}>
                  {deadline.late ? `${-deadline.daysLeft} day${deadline.daysLeft === -1 ? "" : "s"} late` : deadline.daysLeft === 0 ? "Today" : `${deadline.daysLeft} days left`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DetailHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="tax-detail-head">
      <h3>{title}</h3>
      <p>{note}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="tax-empty">{text}</p>;
}

function Two({ main, sub }: { main: React.ReactNode; sub?: string }) {
  return (
    <span className="tax-two">
      <span>{main}</span>
      {sub && <small>{sub}</small>}
    </span>
  );
}

function Status({ status, nil }: { status: VatPeriodView["status"]; nil: boolean }) {
  if (status === "filed") return <span className="pill ok">Filed</span>;
  if (status === "open") return <span className="pill">This month</span>;
  if (status === "late") return <span className="pill danger">{nil ? "Late · nil return" : "Late"}</span>;
  return <span className="pill warn">{nil ? "Due · nil return" : "Due"}</span>;
}

/** A small table; `numeric` lists the right-aligned (money) columns. */
function Rows({ head, rows, total, numeric }: { head: string[]; rows: React.ReactNode[][]; total?: React.ReactNode[]; numeric: number[] }) {
  const cls = (index: number, extra = "") => `${numeric.includes(index) ? "num tnum" : ""} ${extra}`.trim() || undefined;
  return (
    <div className="table-wrap">
      <table className="data-table tax-table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} className={cls(index)}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index} className={cls(index)}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              {total.map((cell, index) => (
                <td key={index} className={cls(index, "font-semibold")}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** The plain-language steps. General rules: confirm anything unusual with IRD. */
function Guide() {
  return (
    <div className="tax-guide">
      <div>
        <h4>VAT · every Nepali month</h4>
        <ol>
          <li>When a month ends, log in to the IRD taxpayer portal with Avernek’s PAN/VAT login.</li>
          <li>File the VAT return: sales (VAT collected) and purchases (VAT on claimable bills). File it even if there is nothing (a nil return).</li>
          <li>Pay what the return shows (bank voucher or online payment) by the 25th of the next month.</li>
          <li>Record it here: “File / pay VAT”, with the voucher number. Tick “Nothing to pay” for a nil return.</li>
        </ol>
      </div>
      <div>
        <h4>TDS · tax we hold back</h4>
        <ol>
          <li>When paying salary, rent or certain services, keep back the tax part and pay the rest.</li>
          <li>Deposit it and file e-TDS (with each person’s PAN) by the 25th of the next month.</li>
          <li>Record it here under the TDS tab. TDS clients held back from us is a credit for our yearly return.</li>
        </ol>
      </div>
      <div>
        <h4>Income tax · once a year, paid in advance</h4>
        <ol>
          <li>Estimate the year’s profit. Pay 40% of its tax by Poush end, 70% by Chaitra end, 100% by Ashadh end (not needed if the tax is under NPR 7,500).</li>
          <li>File the annual return by Ashwin end (three months after the year ends). The deadline to file can be extended by 3 months; paying cannot.</li>
          <li>Rates and IT-company concessions change with each budget: confirm the year’s rate with IRD.</li>
        </ol>
      </div>
      <p className="tax-guide-note">
        Late filing or payment brings fines and interest. These are the general IRD rules; check anything unusual on ird.gov.np or with IRD’s help desk.
      </p>
    </div>
  );
}
