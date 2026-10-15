"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Segmented } from "@/components/controls";
import { compactNumber, formatNumber } from "@/lib/format";

export type CashflowPoint = {
  key: string;
  label: string;
  moneyIn: number;
  companyOut: number;
  founderOut: number;
};
export type CategorySlice = { name: string; value: number };

const CATEGORY_COLORS = ["#8b5cf6", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#22d3ee", "#a3a3b2"];

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: number; color: string; strong?: boolean }[] }) {
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="chart-tooltip-row">
          <span className="inline-flex items-center gap-2">
            <span className="chart-swatch" style={{ background: row.color }} />
            <span className={row.strong ? "font-semibold" : "muted"}>{row.label}</span>
          </span>
          <strong>NPR {formatNumber(Math.round(row.value))}</strong>
        </div>
      ))}
    </div>
  );
}

export function CashflowChart({ points }: { points: CashflowPoint[] }) {
  const [span, setSpan] = useState<"6" | "12">("6");
  const data = useMemo(
    () =>
      points.slice(-Number(span)).map((point) => ({
        ...point,
        net: point.moneyIn - point.companyOut,
      })),
    [points, span]
  );
  const empty = data.every((point) => !point.moneyIn && !point.companyOut && !point.founderOut);
  const totals = data.reduce(
    (sum, point) => ({ in: sum.in + point.moneyIn, out: sum.out + point.companyOut + point.founderOut }),
    { in: 0, out: 0 }
  );

  return (
    <section className="card chart-card rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="section-title">Cash flow</h3>
          <div className="legend-inline mt-2">
            <span><span className="chart-swatch" style={{ background: "#34d399" }} />In <strong className="tnum text-[var(--ink)]">{compactNumber(totals.in)}</strong></span>
            <span><span className="chart-swatch" style={{ background: "#8b5cf6" }} />Company out</span>
            <span><span className="chart-swatch" style={{ background: "#f472b6" }} />Founder-paid</span>
            <span><span className="inline-block w-3 h-0.5 rounded" style={{ background: "var(--ink)" }} />Net</span>
          </div>
        </div>
        <Segmented value={span} onChange={setSpan} size="sm" options={[{ value: "6", label: "6M" }, { value: "12", label: "12M" }]} />
      </div>
      {empty ? (
        <ChartEmpty />
      ) : (
        <div className="h-[280px] mt-4 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 6, left: 0, bottom: 0 }} barGap={3}>
              <defs>
                <linearGradient id="cf-in" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="cf-out" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12.5 }} dy={6} />
              <YAxis axisLine={false} tickLine={false} width={46} tick={{ fill: "var(--muted-2)", fontSize: 12 }} tickFormatter={(value) => compactNumber(Number(value))} />
              <Tooltip
                cursor={{ fill: "var(--hover)" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as CashflowPoint & { net: number };
                  return (
                    <TooltipBox
                      title={String(label)}
                      rows={[
                        { label: "Money in", value: point.moneyIn, color: "#34d399" },
                        { label: "Company out", value: point.companyOut, color: "#8b5cf6" },
                        { label: "Founder-paid", value: point.founderOut, color: "#f472b6" },
                        { label: "Net (company)", value: point.net, color: "var(--ink)", strong: true },
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="moneyIn" fill="url(#cf-in)" radius={[6, 6, 2, 2]} maxBarSize={26} animationDuration={700} />
              <Bar dataKey="companyOut" stackId="out" fill="url(#cf-out)" maxBarSize={26} animationDuration={700} />
              <Bar dataKey="founderOut" stackId="out" fill="#f472b6" fillOpacity={0.85} radius={[6, 6, 2, 2]} maxBarSize={26} animationDuration={700} />
              <Line type="monotone" dataKey="net" stroke="var(--ink)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "var(--ink)" }} activeDot={{ r: 5 }} animationDuration={900} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export function CategoryChart({
  periods,
}: {
  periods: { month: CategorySlice[]; quarter: CategorySlice[]; all: CategorySlice[] };
}) {
  const [period, setPeriod] = useState<"month" | "quarter" | "all">("month");
  const [hover, setHover] = useState<number | null>(null);
  const raw = periods[period];
  const slices = useMemo(() => {
    const sorted = [...raw].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((sum, item) => sum + item.value, 0);
    return rest > 0 ? [...top, { name: "Other", value: rest }] : top;
  }, [raw]);
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  const focus = hover != null ? slices[hover] : null;

  return (
    <section className="card chart-card rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="section-title">Where money goes</h3>
          <p className="section-kicker">Company and founder spending by category</p>
        </div>
        <Segmented
          value={period}
          onChange={(value) => {
            setPeriod(value);
            setHover(null);
          }}
          size="sm"
          options={[
            { value: "month", label: "Month" },
            { value: "quarter", label: "3M" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {slices.length === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="grid sm:grid-cols-[184px_minmax(0,1fr)] items-center gap-6 mt-5">
          <div className="relative h-[184px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="70%"
                  outerRadius="96%"
                  paddingAngle={2.5}
                  cornerRadius={4}
                  stroke="none"
                  animationDuration={700}
                  onMouseEnter={(_, index) => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                >
                  {slices.map((item, index) => (
                    <Cell
                      key={item.name}
                      fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                      opacity={hover == null || hover === index ? 1 : 0.3}
                      style={{ transition: "opacity 160ms ease", outline: "none" }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-6">
              <strong className="text-[22px] font-semibold tnum tracking-tight">{compactNumber(focus ? focus.value : total)}</strong>
              <span className="text-[12.5px] muted truncate max-w-full">{focus ? focus.name : "Total spent"}</span>
            </div>
          </div>
          <div className="chart-legend">
            {slices.map((item, index) => (
              <div
                key={item.name}
                className={`chart-legend-row ${hover === index ? "chart-legend-row-on" : ""}`}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="chart-swatch" style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
                <span className="chart-legend-name">{item.name}</span>
                <span className="chart-legend-percent">{total ? Math.round((item.value / total) * 100) : 0}%</span>
                <strong>{compactNumber(item.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ChartEmpty() {
  return (
    <div className="chart-empty">
      <strong>Nothing to chart yet</strong>
      <span>Spending in this period will show up here.</span>
    </div>
  );
}

export default CashflowChart;
