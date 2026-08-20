"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionHeader } from "@/components/ui";

const CHART_COLORS = [
  "var(--accent)",
  "var(--blue)",
  "var(--green)",
  "var(--amber)",
  "color-mix(in srgb, var(--ink) 38%, transparent)",
];

type CategoryPoint = { name: string; value: number };
type MonthPoint = { label: string; value: number; current: boolean };

function compactNpr(value: number) {
  if (value >= 1_000_000) return `NPR ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `NPR ${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `NPR ${(value / 1000).toFixed(1)}k`;
  return `NPR ${Math.round(value)}`;
}

const tooltipStyle = {
  border: "1px solid var(--line-strong)",
  borderRadius: 12,
  background: "var(--surface)",
  boxShadow: "var(--shadow-card)",
  color: "var(--ink)",
  fontSize: 12,
};

export default function DashboardCharts({
  categories,
  months,
  total,
}: {
  categories: CategoryPoint[];
  months: MonthPoint[];
  total: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="dashboard-chart-grid">
      <motion.section
        className="card chart-card"
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <SectionHeader title="Spend by category" subtitle="Share of all recorded spending" />
        {categories.length === 0 ? (
          <ChartEmpty />
        ) : (
          <div className="chart-category-layout">
            <div className="chart-donut-wrap" aria-label={`Total spending ${compactNpr(total)}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="68%"
                    outerRadius="92%"
                    paddingAngle={2}
                    stroke="transparent"
                    isAnimationActive={!reduceMotion}
                    animationDuration={800}
                  >
                    {categories.map((item, index) => (
                      <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [compactNpr(Number(value)), "Spend"]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-center-label">
                <strong>{compactNpr(total).replace("NPR ", "")}</strong>
                <span>total spend</span>
              </div>
            </div>
            <div className="chart-legend">
              {categories.map((item, index) => (
                <div key={item.name} className="chart-legend-row">
                  <span className="chart-swatch" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                  <span className="chart-legend-name">{item.name}</span>
                  <span className="chart-legend-percent">{Math.round((item.value / total) * 100)}%</span>
                  <strong>{compactNpr(item.value).replace("NPR ", "")}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.section>

      <motion.section
        className="card chart-card"
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.42, delay: reduceMotion ? 0 : 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <SectionHeader title="Monthly spend" subtitle="Six-month cost trend" />
        {months.every((month) => month.value === 0) ? (
          <ChartEmpty />
        ) : (
          <div className="chart-bar-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 18, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="4 5" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tick={{ fill: "var(--muted-2)", fontSize: 10 }}
                  tickFormatter={(value) => compactNpr(Number(value)).replace("NPR ", "")}
                />
                <Tooltip
                  cursor={{ fill: "var(--accent-soft)" }}
                  contentStyle={tooltipStyle}
                  formatter={(value) => [compactNpr(Number(value)), "Spend"]}
                />
                <Bar dataKey="value" radius={[7, 7, 3, 3]} maxBarSize={46} isAnimationActive={!reduceMotion} animationDuration={750}>
                  {months.map((month) => (
                    <Cell
                      key={month.label}
                      fill={month.current ? "var(--accent)" : "color-mix(in srgb, var(--ink) 28%, transparent)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </motion.section>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="chart-empty">
      <strong>No chart data yet</strong>
      <span>Add an expense to unlock this view.</span>
    </div>
  );
}
