"use client";

import dynamic from "next/dynamic";

/**
 * The chart library is the heaviest thing on the overview. Loading it after the
 * page paints keeps the numbers on screen immediately; the charts follow.
 */
function ChartSkeleton() {
  return <div className="card chart-card skeleton h-[372px]" aria-hidden="true" />;
}

export const CashflowChart = dynamic(() => import("./DashboardCharts").then((mod) => mod.CashflowChart), {
  ssr: false,
  loading: ChartSkeleton,
});

export const CategoryChart = dynamic(() => import("./DashboardCharts").then((mod) => mod.CategoryChart), {
  ssr: false,
  loading: ChartSkeleton,
});
