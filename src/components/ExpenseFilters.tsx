"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Icon from "@/components/Icons";
import { MonthPicker, Segmented } from "@/components/controls";
import ExportMenu from "@/components/ExportMenu";
import { monthLabel, shiftMonth } from "@/lib/dates";
import type { ExpenseSearch } from "@/lib/expense-filters";

type Option = { value: string; label: string };

/**
 * Filters apply the moment they change — no Filter button. Each change rewrites
 * the URL (so a filtered view can be bookmarked or shared) and the server
 * re-renders the list in a transition, keeping the current list on screen
 * until the new one is ready.
 */
export default function ExpenseFilters({
  sp,
  periodLabel,
  monthKey,
  today,
  categories,
  vendors,
  clients,
  people,
  accounts,
  founder = true,
  monthsWithData,
  futureCount,
}: {
  sp: ExpenseSearch;
  periodLabel: string;
  monthKey: string;
  today: string;
  categories: Option[];
  vendors: Option[];
  clients: string[];
  people: Option[];
  accounts: { id: string; label: string }[];
  /** False for people who may not see founder-paid expenses. */
  founder?: boolean;
  monthsWithData: string[];
  futureCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(sp.q ?? "");
  const [from, setFrom] = useState(sp.from ?? "");
  const [to, setTo] = useState(sp.to ?? "");
  const thisMonth = today.slice(0, 7);
  const period = sp.period ?? "month";
  const marked = useMemo(() => new Set(monthsWithData), [monthsWithData]);
  const first = useRef(true);

  // Quick successive clicks merge into the newest filters, not the last render.
  const latest = useRef<ExpenseSearch>(sp);
  useEffect(() => {
    latest.current = sp;
  }, [sp]);

  function apply(changes: Partial<Record<keyof ExpenseSearch, string | null>>) {
    const merged = { ...latest.current, ...changes } as Record<string, string | null | undefined>;
    latest.current = Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null && value !== "")) as ExpenseSearch;
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value != null && value !== "") next.set(key, String(value));
    }
    const query = next.toString();
    start(() => router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false }));
  }

  // Search applies after a short pause in typing.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if ((sp.q ?? "") !== search) apply({ q: search || null });
    }, 320);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Custom dates apply after a short pause too: typing a year digit by digit
  // passes through 0002, 0020, 0202 on the way to 2026.
  useEffect(() => {
    if (period !== "custom") return;
    const complete = (value: string) => value === "" || /^(19|20)\d\d-\d\d-\d\d$/.test(value);
    if (!complete(from) || !complete(to)) return;
    if ((sp.from ?? "") === from && (sp.to ?? "") === to) return;
    const timer = window.setTimeout(() => apply({ period: "custom", from: from || null, to: to || null }), 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, period]);

  const ledger = sp.ledger ?? "";
  const personId = sp.person ?? sp.payer ?? "";
  const active =
    Boolean(sp.ledger || sp.cat || sp.vendor || sp.client || personId || sp.q) || (sp.period && sp.period !== "month") || (sp.month && sp.month !== thisMonth);
  const filtered = Boolean(sp.ledger || sp.cat || sp.vendor || sp.client || personId || sp.q);
  // The export always carries the period, so it downloads exactly this view.
  const exportQuery = new URLSearchParams(
    Object.entries({ period: "month", month: monthKey, ...sp }).filter(([, value]) => value != null && value !== "") as [string, string][]
  ).toString();

  return (
    <div className={`card mb-5 ${pending ? "filter-loading" : ""}`}>
      {/* period */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn !w-9 !h-9"
            aria-label="Previous month"
            onClick={() => apply({ period: "month", month: shiftMonth(period === "month" ? monthKey : thisMonth, -1), from: null, to: null })}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <MonthPicker
            value={monthKey}
            maxKey={thisMonth}
            marked={marked}
            onChange={(key) => apply({ period: "month", month: key, from: null, to: null })}
          >
            {periodLabel}
          </MonthPicker>
          <button
            type="button"
            className="icon-btn !w-9 !h-9"
            aria-label="Next month"
            disabled={period === "month" && monthKey >= thisMonth}
            onClick={() => {
              const next = shiftMonth(period === "month" ? monthKey : thisMonth, 1);
              apply({ period: "month", month: next > thisMonth ? thisMonth : next, from: null, to: null });
            }}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            ["month", "This month"],
            ["last", "Last month"],
            ["year", "This year"],
            ["all", "All time"],
            ["custom", "Custom dates"],
          ].map(([value, label]) => {
            const on = value === "month" ? period === "month" && monthKey === thisMonth : period === value;
            return (
              <button
                key={value}
                type="button"
                className={`chip !h-8 ${on ? "chip-on" : ""}`}
                onClick={() => {
                  const customFrom = from || `${thisMonth}-01`;
                  const customTo = to || today;
                  if (value === "custom") {
                    setFrom(customFrom);
                    setTo(customTo);
                  }
                  apply({
                    period: value === "month" ? null : value,
                    month: null,
                    from: value === "custom" ? customFrom : null,
                    to: value === "custom" ? customTo : null,
                  });
                }}
              >
                {label}
              </button>
            );
          })}
          {futureCount > 0 && (
            <button
              type="button"
              className={`chip !h-8 ${period === "future" ? "chip-on" : ""}`}
              style={{ color: "var(--amber)" }}
              onClick={() => apply({ period: "future", month: null, from: null, to: null })}
            >
              <Icon name="alert" size={13} /> Future-dated <span className="chip-count">{futureCount}</span>
            </button>
          )}
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="date-field">
              From
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="date-field">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {pending && <span className="text-[12.5px] muted">Updating…</span>}
          <ExportMenu
            choices={[
              { label: "What's on screen", hint: filtered ? `${periodLabel} · with your filters` : periodLabel, href: `/api/export?${exportQuery}` },
              { label: "This month", hint: `${monthLabel(thisMonth)} · all expenses`, href: `/api/export?period=month&month=${thisMonth}` },
              { label: "Last month", hint: `${monthLabel(shiftMonth(thisMonth, -1))} · all expenses`, href: "/api/export?period=last" },
              { label: "This year", hint: `${today.slice(0, 4)} · all expenses`, href: "/api/export?period=year" },
              { label: "All time", hint: "Every expense ever", href: "/api/export?period=all" },
            ]}
          />
        </div>
      </div>

      {/* refine */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Segmented
          size="sm"
          value={ledger}
          onChange={(value) => apply({ ledger: value || null })}
          options={[
            { value: "", label: "All money" },
            ...(founder ? [{ value: "founder", label: "Founder" }] : []),
            ...accounts.map((account) => ({ value: `account:${account.id}`, label: account.label.replace(" account", "") })),
          ]}
        />
        <FilterSelect label="Category" value={sp.cat ?? ""} options={categories} onChange={(value) => apply({ cat: value || null })} />
        <FilterSelect label="Vendor" value={sp.vendor ?? ""} options={vendors} onChange={(value) => apply({ vendor: value || null })} />
        {clients.length > 0 && (
          <FilterSelect label="Client" value={sp.client ?? ""} options={clients.map((client) => ({ value: client, label: client }))} onChange={(value) => apply({ client: value || null })} />
        )}
        {people.length > 0 && (
          <FilterSelect
            label="Person"
            value={personId}
            options={people}
            onChange={(value) => apply({ person: value || null, payer: null, basis: value ? sp.basis ?? "share" : null })}
          />
        )}
        {personId && (
          <Segmented
            size="sm"
            value={sp.basis === "paid" ? "paid" : "share"}
            onChange={(value) => apply({ basis: value })}
            options={[
              { value: "share", label: "Their share", title: "Expenses this person's investment share covers" },
              { value: "paid", label: "They paid", title: "Expenses this person paid personally" },
            ]}
          />
        )}
        <div className="search-field ml-auto">
          <Icon name="search" size={15} />
          <input className="input !w-[220px]" placeholder="Search note, vendor, client…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search expenses" />
        </div>
        {active && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setSearch("");
              setFrom("");
              setTo("");
              latest.current = {};
              start(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <Icon name="close" size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={`${label} filter`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="input filter-select"
      style={value ? { borderColor: "var(--accent-line)", background: "var(--accent-soft)" } : undefined}
    >
      <option value="">{`All ${label.toLowerCase()}s`.replace("persons", "people").replace("categorys", "categories")}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
