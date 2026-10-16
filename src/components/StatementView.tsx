"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Icon, { type IconName } from "@/components/Icons";
import { Money } from "@/components/ui";
import { Segmented, Tabs } from "@/components/controls";
import PeriodPicker, { describePeriod, initialPeriod, periodRange, type Period } from "@/components/PeriodPicker";
import { dayLabel, monthLabel, monthRange } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import type { StatementAccount, StatementEvent, StatementKind } from "@/lib/statement";

const KIND_META: Record<StatementKind, { icon: IconName; tone: string; soft: string; label: string }> = {
  client: { icon: "income", tone: "var(--green)", soft: "var(--green-soft)", label: "Client payment" },
  other_income: { icon: "sparkles", tone: "var(--green)", soft: "var(--green-soft)", label: "Other income" },
  capital: { icon: "contribution", tone: "var(--accent-ink)", soft: "var(--accent-soft)", label: "Capital added" },
  expense: { icon: "expense", tone: "var(--red)", soft: "var(--red-soft)", label: "Company expense" },
  founder: { icon: "user", tone: "var(--pink)", soft: "rgb(244 114 182 / 0.12)", label: "Founder-paid" },
  transfer: { icon: "swap", tone: "var(--blue)", soft: "var(--blue-soft)", label: "Transfer" },
  reimbursement: { icon: "swap", tone: "var(--blue)", soft: "var(--blue-soft)", label: "Reimbursement" },
  vat: { icon: "receipt", tone: "var(--amber)", soft: "var(--amber-soft)", label: "VAT paid" },
  loan: { icon: "arrowUpRight", tone: "var(--amber)", soft: "var(--amber-soft)", label: "Loan out" },
  loan_back: { icon: "arrowDownLeft", tone: "var(--green)", soft: "var(--green-soft)", label: "Loan returned" },
};

const PAGE = 80;

export default function StatementView({
  events,
  accounts,
  today,
  scope = "all",
  initialAccount = "all",
  compact = false,
}: {
  events: StatementEvent[];
  accounts: StatementAccount[];
  today: string;
  /** "company" hides the founder ledger (Company money page). */
  scope?: "all" | "company";
  initialAccount?: string;
  compact?: boolean;
}) {
  const thisMonth = today.slice(0, 7);
  const [period, setPeriod] = useState<Period>(() => initialPeriod(today));
  const [account, setAccount] = useState(initialAccount);
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"tx" | "months">("tx");
  const [limit, setLimit] = useState(PAGE);

  const companyIds = useMemo(() => new Set(accounts.filter((a) => a.kind !== "founder").map((a) => a.id)), [accounts]);
  const scoped = useMemo(
    () => (scope === "company" ? events.filter((event) => event.account !== "founder") : events),
    [events, scope]
  );
  const monthsWithData = useMemo(() => new Set(scoped.map((event) => event.date.slice(0, 7))), [scoped]);
  const firstDate = scoped.length ? scoped[scoped.length - 1].date : today;

  const range = useMemo(() => periodRange(period, today, firstDate), [period, today, firstDate]);
  const periodLabel = describePeriod(period, today, range);

  const isFounder = account === "founder";
  const isAll = account === "all";
  const matchesAccount = (event: StatementEvent) => (isAll ? true : event.account === account);
  /** Events that move a company balance in the current account scope. */
  const balanceScope = (event: StatementEvent) => event.account !== "founder" && (isAll ? companyIds.has(event.account) || event.account === "unassigned" : event.account === account);
  const counts = (event: StatementEvent) => !(isAll && event.internal);

  const stats = useMemo(() => {
    let opening = 0;
    let moneyIn = 0;
    let moneyOut = 0;
    let founderOut = 0;
    let vatInside = 0;
    const by: Record<string, number> = {};
    const add = (key: string, value: number) => (by[key] = (by[key] ?? 0) + value);
    for (const event of scoped) {
      if (!matchesAccount(event)) continue;
      const signed = event.direction === "in" ? event.amount : -event.amount;
      if (event.date < range.from) {
        if (balanceScope(event)) opening += signed;
        continue;
      }
      if (event.date > range.to) continue;
      if (event.account === "founder") {
        founderOut += event.amount;
        add("founder", event.amount);
        if (event.category) add(`cat:${event.category}`, event.amount);
        continue;
      }
      if (!balanceScope(event)) continue;
      if (!counts(event)) {
        add("internal", event.amount / 2);
        continue;
      }
      if (event.direction === "in") moneyIn += event.amount;
      else moneyOut += event.amount;
      if (event.vat) vatInside += event.vat;
      if (event.kind === "client") add(`client:${event.account}`, event.amount);
      else add(event.kind, event.amount);
      if (event.kind === "expense" && event.client) add("clientCosts", event.amount);
    }
    return { opening, moneyIn, moneyOut, closing: opening + moneyIn - moneyOut, founderOut, vatInside, by };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, account, range.from, range.to]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    // Running balance, oldest → newest, for rows that move a company balance.
    const chronological = scoped
      .filter((event) => matchesAccount(event) && event.date >= range.from && event.date <= range.to)
      .slice()
      .reverse();
    let running = stats.opening;
    const withBalance = chronological.map((event) => {
      if (balanceScope(event)) running += event.direction === "in" ? event.amount : -event.amount;
      return { event, balance: balanceScope(event) ? running : null };
    });
    return withBalance
      .reverse()
      .filter(({ event }) => (direction === "all" ? true : event.direction === direction))
      .filter(({ event }) =>
        needle
          ? `${event.title} ${event.detail} ${event.client ?? ""} ${event.category ?? ""}`.toLowerCase().includes(needle)
          : true
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, account, range.from, range.to, direction, search, stats.opening]);

  const grouped = useMemo(() => {
    const days: { date: string; items: typeof rows; net: number }[] = [];
    for (const row of rows.slice(0, limit)) {
      const last = days[days.length - 1];
      const skip = row.event.account === "founder" || (isAll && row.event.internal);
      const signed = skip ? 0 : row.event.direction === "in" ? row.event.amount : -row.event.amount;
      if (last && last.date === row.event.date) {
        last.items.push(row);
        last.net += signed;
      } else {
        days.push({ date: row.event.date, items: [row], net: signed });
      }
    }
    return days;
  }, [rows, limit, isAll]);

  const monthly = useMemo(() => {
    const keys = [...monthsWithData].filter((key) => key <= thisMonth).sort().reverse();
    const vatId = accounts.find((a) => a.kind === "company_bank")?.id;
    const nonVatId = accounts.find((a) => a.kind === "personal_custody")?.id;
    let balance = 0;
    const ascending = [...keys].reverse().map((key) => {
      const { from: start, to: end } = monthRange(key);
      let inVat = 0, inNonVat = 0, inOther = 0, out = 0, founder = 0;
      for (const event of scoped) {
        if (event.date < start || event.date > end) continue;
        if (event.account === "founder") { founder += event.amount; continue; }
        if (event.internal) continue;
        if (event.direction === "in") {
          if (event.account === vatId) inVat += event.amount;
          else if (event.account === nonVatId) inNonVat += event.amount;
          else inOther += event.amount;
        } else out += event.amount;
      }
      balance += inVat + inNonVat + inOther - out;
      return { key, inVat, inNonVat: inNonVat + inOther, out, net: inVat + inNonVat + inOther - out, founder, balance };
    });
    return ascending.reverse();
  }, [monthsWithData, thisMonth, accounts, scoped]);

  function exportCsv() {
    const header = ["Date", "Account", "Type", "Description", "Details", "Money in", "Money out", "Balance"];
    const lines = rows.map(({ event, balance }) => [
      event.date,
      accountName(event.account),
      KIND_META[event.kind].label,
      event.title,
      event.detail,
      event.direction === "in" ? event.amount.toFixed(2) : "",
      event.direction === "out" ? event.amount.toFixed(2) : "",
      balance == null ? "" : balance.toFixed(2),
    ]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `avernek-statement-${range.from}-to-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function accountName(id: string) {
    if (id === "founder") return "Founder-paid";
    return accounts.find((a) => a.id === id)?.label ?? "Unassigned";
  }

  const accountOptions = [
    { value: "all", label: scope === "company" ? "All accounts" : "All" },
    ...accounts.filter((a) => a.kind !== "founder").map((a) => ({ value: a.id, label: a.label.replace(" account", "") })),
    ...(scope === "all" ? [{ value: "founder", label: "Founder" }] : []),
  ];

  const by = stats.by;
  const clientRows = accounts
    .filter((a) => a.kind !== "founder")
    .map((a) => ({ label: `Clients → ${a.label}`, value: by[`client:${a.id}`] ?? 0 }))
    .filter((row) => row.value > 0);
  const breakdown = isFounder
    ? Object.entries(by)
        .filter(([key]) => key.startsWith("cat:"))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key, value]) => ({ label: key.slice(4), value, sign: "out" as const }))
    : [
        ...clientRows.map((row) => ({ ...row, sign: "in" as const })),
        { label: "Other income", value: by.other_income ?? 0, sign: "in" as const },
        { label: "Capital added", value: by.capital ?? 0, sign: "in" as const },
        { label: "Loans returned", value: by.loan_back ?? 0, sign: "in" as const },
        { label: "Company expenses", value: by.expense ?? 0, sign: "out" as const },
        { label: "· of which client costs", value: by.clientCosts ?? 0, sign: "out" as const },
        { label: "VAT paid to IRD", value: by.vat ?? 0, sign: "out" as const },
        { label: "Loans given", value: by.loan ?? 0, sign: "out" as const },
        { label: isAll ? "Moved between accounts" : "Transfers", value: isAll ? by.internal ?? 0 : (by.transfer ?? 0) + (by.reimbursement ?? 0), sign: "flat" as const },
        ...(scope === "all" && isAll ? [{ label: "Founder-paid (own pocket)", value: stats.founderOut, sign: "out" as const }] : []),
      ].filter((row) => row.value > 0);

  return (
    <div className="card overflow-hidden rise">
      {/* toolbar */}
      <div className="stmt-toolbar">
        <PeriodPicker
          period={period}
          today={today}
          label={periodLabel}
          marked={monthsWithData}
          onChange={(next) => {
            setPeriod(next);
            setLimit(PAGE);
          }}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented value={account} onChange={(value) => { setAccount(value); setLimit(PAGE); }} options={accountOptions} size="sm" />
        </div>
      </div>

      {/* summary */}
      {isFounder ? (
        <dl className="stmt-summary">
          <div>
            <dt>Founder-paid</dt>
            <dd><Money value={stats.founderOut} /></dd>
            <small>Own-pocket spending · no account balance</small>
          </div>
          <div>
            <dt>Entries</dt>
            <dd className="tnum">{rows.length}</dd>
            <small>{periodLabel}</small>
          </div>
          <div>
            <dt>Largest</dt>
            <dd><Money value={rows.reduce((max, row) => Math.max(max, row.event.amount), 0)} /></dd>
            <small>{rows.slice().sort((a, b) => b.event.amount - a.event.amount)[0]?.event.title ?? "—"}</small>
          </div>
          <div>
            <dt>Top category</dt>
            <dd className="!text-[17px] truncate">{breakdown[0]?.label ?? "—"}</dd>
            <small>{breakdown[0] ? <Money value={breakdown[0].value} /> : "No spending"}</small>
          </div>
        </dl>
      ) : (
        <dl className="stmt-summary">
          <div>
            <dt>Opening balance</dt>
            <dd><Money value={stats.opening} /></dd>
            <small>On {dayLabel(range.from)}</small>
          </div>
          <div>
            <dt>Money in</dt>
            <dd className="text-green"><Money value={stats.moneyIn} /></dd>
            <small>{stats.vatInside > 0 ? <>incl. <Money value={stats.vatInside} /> VAT for IRD</> : "Clients, income & capital"}</small>
          </div>
          <div>
            <dt>Money out</dt>
            <dd className="text-red"><Money value={stats.moneyOut} /></dd>
            <small>{scope === "all" && isAll && stats.founderOut > 0 ? <>+ <Money value={stats.founderOut} /> founder-paid</> : "Costs, VAT & loans"}</small>
          </div>
          <div>
            <dt>Closing balance</dt>
            <dd><Money value={stats.closing} /></dd>
            <small className={stats.moneyIn - stats.moneyOut >= 0 ? "text-green" : "text-red"}>
              {stats.moneyIn - stats.moneyOut >= 0 ? "+" : "−"}{formatNumber(Math.abs(stats.moneyIn - stats.moneyOut))} net this period
            </small>
          </div>
        </dl>
      )}

      {breakdown.length > 0 && (
        <div className="stmt-breakdown">
          {breakdown.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong className={row.sign === "in" ? "text-green" : row.sign === "out" ? "" : "muted"}>
                {row.sign === "in" ? "+" : row.sign === "out" ? "−" : ""}{formatNumber(row.value)}
              </strong>
            </div>
          ))}
        </div>
      )}

      {/* list controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "tx", label: "Transactions", count: rows.length },
            { value: "months", label: "Month by month" },
          ]}
        />
        {view === "tx" && (
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <Segmented
              value={direction}
              onChange={setDirection}
              size="sm"
              options={[
                { value: "all", label: "All" },
                { value: "in", label: "Money in" },
                { value: "out", label: "Money out" },
              ]}
            />
            <div className="search-field">
              <Icon name="search" size={15} />
              <input className="input !w-[200px]" placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <button type="button" className="btn btn-sm" onClick={exportCsv} title="Download this view as CSV">
              <Icon name="download" size={14} /> Export
            </button>
          </div>
        )}
      </div>

      {view === "tx" ? (
        <div className={compact ? "stmt-scroll !max-h-[520px] border-t" : "border-t"}>
          {grouped.length === 0 && (
            <div className="empty-state !min-h-[160px]">
              <div className="empty-icon"><Icon name="statement" size={18} /></div>
              <div className="text-[15px] font-semibold">No transactions in {periodLabel}</div>
              <div className="mt-1 text-[13.5px] muted">Pick another month or widen the dates.</div>
            </div>
          )}
          {grouped.map((day) => (
            <div key={day.date}>
              <div className="stmt-day">
                <span>{dayLabel(day.date)}{day.date === today ? " · Today" : ""}</span>
                {day.net !== 0 && <span className={`tnum ${day.net > 0 ? "text-green" : ""}`}>{day.net > 0 ? "+" : "−"}{formatNumber(Math.abs(day.net))}</span>}
              </div>
              <div className="row-list">
                {day.items.map(({ event, balance }) => {
                  const meta = KIND_META[event.kind];
                  const body = (
                    <>
                      <div className="row-icon" style={{ "--tone": meta.tone, "--tone-soft": meta.soft } as React.CSSProperties}>
                        <Icon name={meta.icon} size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="row-title">{event.title}</div>
                        <div className="row-meta">
                          {meta.label} · {accountName(event.account)}
                          {event.detail ? ` · ${event.detail}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`row-amount ${event.direction === "in" ? "text-green" : event.internal ? "" : ""}`}>
                          {event.direction === "in" ? "+" : "−"}{formatNumber(event.amount, event.currency)}
                        </div>
                        {balance != null && <div className="row-sub">Bal {formatNumber(balance)}</div>}
                      </div>
                    </>
                  );
                  return event.href ? (
                    <Link key={event.id} href={event.href} className="row-item">{body}</Link>
                  ) : (
                    <div key={event.id} className="row-item">{body}</div>
                  );
                })}
              </div>
            </div>
          ))}
          {rows.length > limit && (
            <div className="p-3 text-center border-t">
              <button type="button" className="btn btn-sm" onClick={() => setLimit((value) => value + PAGE)}>
                Show {Math.min(PAGE, rows.length - limit)} more
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap border-t">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">In · VAT account</th>
                <th className="num">In · Non-VAT</th>
                <th className="num">Money out</th>
                <th className="num">Net</th>
                {scope === "all" && <th className="num">Founder-paid</th>}
                <th className="num">Balance at end</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr
                  key={row.key}
                  className="cursor-pointer"
                  onClick={() => {
                    setPeriod((current) => ({ ...current, mode: "month", monthKey: row.key }));
                    setAccount("all");
                    setView("tx");
                  }}
                >
                  <td className="font-medium">{monthLabel(row.key)}</td>
                  <td className="num text-green">{row.inVat ? `+${formatNumber(row.inVat)}` : "—"}</td>
                  <td className="num text-green">{row.inNonVat ? `+${formatNumber(row.inNonVat)}` : "—"}</td>
                  <td className="num">{row.out ? `−${formatNumber(row.out)}` : "—"}</td>
                  <td className={`num font-semibold ${row.net >= 0 ? "text-green" : "text-red"}`}>{row.net >= 0 ? "+" : "−"}{formatNumber(Math.abs(row.net))}</td>
                  {scope === "all" && <td className="num">{row.founder ? `−${formatNumber(row.founder)}` : "—"}</td>}
                  <td className="num font-semibold">{formatNumber(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
