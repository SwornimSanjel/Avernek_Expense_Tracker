import type { ConversionStatus, FxSource } from "@/lib/types";
import { fxSourceLabel } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="muted text-sm mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function StatTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="text-[13px] muted font-medium">{label}</div>
      <div
        className={`tnum mt-2 font-bold tracking-tight ${
          emphasis ? "text-3xl" : "text-2xl"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-xs muted mt-1">{hint}</div>}
    </div>
  );
}

/** Restrained FX label — small pill, never a warning banner. */
export function FxBadge({
  source,
  status,
}: {
  source: FxSource;
  status: ConversionStatus;
}) {
  const cls =
    status === "pending" ? "pill warn" : status === "exact" ? "pill ok" : "pill";
  return <span className={cls}>{fxSourceLabel(source)}</span>;
}
