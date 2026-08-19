import type { ConversionStatus, FxSource } from "@/lib/types";
import { fxSourceLabel } from "@/lib/format";
import Icon, { type IconName } from "@/components/Icons";

export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow = "Avernek finance",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow"><Icon name="sparkles" size={12} />{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-kicker mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  emphasis,
  icon,
  tone = "accent",
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  icon?: IconName;
  tone?: "accent" | "green" | "amber" | "blue";
}) {
  const glow = {
    accent: "rgb(139 92 246 / 0.13)",
    green: "rgb(70 216 144 / 0.11)",
    amber: "rgb(245 185 76 / 0.11)",
    blue: "rgb(96 165 250 / 0.11)",
  }[tone];
  const toneColor = {
    accent: "#b8a0fb",
    green: "var(--green)",
    amber: "var(--amber)",
    blue: "var(--blue)",
  }[tone];

  return (
    <div className="card stat-tile" style={{ "--stat-glow": glow } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-3">
        <div className="stat-label">{label}</div>
        {icon && <div className="stat-icon" style={{ color: toneColor }}><Icon name={icon} size={15} /></div>}
      </div>
      <div className={`stat-value tnum ${emphasis ? "!text-[2rem]" : ""}`}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function LedgerCard({
  title,
  subtitle,
  badge,
  moneyIn,
  moneyOut,
  balance,
  balanceLabel = "Current balance",
  outLabel = "All-time out",
  note,
  icon = "wallet",
  tone = "accent",
}: {
  title: string;
  subtitle: string;
  badge: string;
  moneyIn?: string;
  moneyOut: string;
  balance?: string;
  balanceLabel?: string;
  outLabel?: string;
  note: string;
  icon?: IconName;
  tone?: "accent" | "green" | "amber" | "blue";
}) {
  const toneColor = {
    accent: "#b8a0fb",
    green: "var(--green)",
    amber: "var(--amber)",
    blue: "var(--blue)",
  }[tone];
  const expenseOnly = moneyIn == null && balance == null;

  return (
    <div className="card ledger-card" style={{ "--ledger-tone": toneColor } as React.CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <div className="stat-icon ledger-icon"><Icon name={icon} size={16} /></div>
        <span className="pill">{badge}</span>
      </div>
      <div className="mt-4">
        <h3 className="font-semibold leading-tight">{title}</h3>
        <p className="text-[10px] muted leading-relaxed mt-1 min-h-[28px]">{subtitle}</p>
      </div>
      <div className="ledger-balance mt-5">
        <span>{expenseOnly ? outLabel : balanceLabel}</span>
        <strong className="tnum">{expenseOnly ? moneyOut : balance}</strong>
      </div>
      {!expenseOnly && (
        <div className="ledger-flows mt-3">
          <div>
            <span>All-time in</span>
            <strong className="tnum">{moneyIn}</strong>
          </div>
          <div>
            <span>{outLabel}</span>
            <strong className="tnum">{moneyOut}</strong>
          </div>
        </div>
      )}
      <p className="ledger-note">{note}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = "receipt",
  action,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={19} /></div>
      <div className="text-sm font-semibold">{title}</div>
      {description && <div className="mt-1 max-w-sm text-xs muted leading-relaxed">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FxBadge({ source, status }: { source: FxSource; status: ConversionStatus }) {
  const cls = status === "pending" ? "pill warn" : status === "exact" ? "pill ok" : "pill";
  return <span className={cls}>{fxSourceLabel(source)}</span>;
}
