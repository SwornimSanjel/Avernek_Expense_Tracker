import type { ConversionStatus, FxSource } from "@/lib/types";
import { formatNumber, fxSourceLabel } from "@/lib/format";
import Link from "next/link";
import Icon, { type IconName } from "@/components/Icons";

/**
 * Shared building blocks. These are server components (no hooks, no client
 * JS): entrance motion is CSS, so pages stay light and fast.
 */

export type Tone = "accent" | "green" | "amber" | "blue" | "red" | "muted" | "pink";

const TONES: Record<Tone, { ink: string; soft: string }> = {
  accent: { ink: "var(--accent-ink)", soft: "var(--accent-soft)" },
  green: { ink: "var(--green)", soft: "var(--green-soft)" },
  amber: { ink: "var(--amber)", soft: "var(--amber-soft)" },
  blue: { ink: "var(--blue)", soft: "var(--blue-soft)" },
  red: { ink: "var(--red)", soft: "var(--red-soft)" },
  pink: { ink: "var(--pink)", soft: "rgb(244 114 182 / 0.12)" },
  muted: { ink: "var(--muted)", soft: "var(--surface-2)" },
};

export function toneVars(tone: Tone): React.CSSProperties {
  return { "--tone": TONES[tone].ink, "--tone-soft": TONES[tone].soft, "--kpi-tone": TONES[tone].ink, "--kpi-tone-soft": TONES[tone].soft } as React.CSSProperties;
}

export function PageHeader({
  title,
  subtitle,
  action,
  meta,
  back,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  meta?: React.ReactNode;
  /** A "← Back" link above the title for detail pages. */
  back?: { href: string; label: string };
  /** Kept for older call sites; no longer shown. */
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="page-header rise">
      <div className="page-header-main">
        {back && (
          <Link href={back.href} className="link-more mb-2">
            <Icon name="arrowLeft" size={14} /> {back.label}
          </Link>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-kicker">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** NPR 1,10,433 with the currency set small and quiet so the number leads. */
export function Money({
  value,
  currency = "NPR",
  signed = false,
  tone,
  className = "",
}: {
  value: number | null | undefined;
  currency?: string;
  /** Prefix + / − and colour by direction. */
  signed?: boolean;
  tone?: "pos" | "neg";
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={`money ${className}`}>—</span>;
  const negative = value < 0;
  const sign = signed ? (negative ? "−" : value > 0 ? "+" : "") : negative ? "−" : "";
  const toneClass = tone === "pos" ? "money-pos" : tone === "neg" ? "money-neg" : signed ? (negative ? "money-neg" : value > 0 ? "money-pos" : "") : "";
  return (
    <span className={`money ${toneClass} ${className}`}>
      <span className="money-cur">{currency}</span>
      <span>{sign}{formatNumber(Math.abs(value), currency)}</span>
    </span>
  );
}

export function Kpi({
  label,
  value,
  foot,
  icon,
  tone = "accent",
  href,
  small,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  foot?: React.ReactNode;
  icon?: IconName;
  tone?: Tone;
  href?: string;
  small?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
        {icon && <div className="kpi-icon"><Icon name={icon} size={16} /></div>}
      </div>
      <div className={`kpi-value ${small ? "kpi-value-sm" : ""}`}>{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </>
  );
  if (href) {
    return (
      <a href={href} className={`kpi kpi-link rise ${className}`} style={toneVars(tone)}>
        {body}
      </a>
    );
  }
  return (
    <div className={`kpi rise ${className}`} style={toneVars(tone)}>
      {body}
    </div>
  );
}

/** Older name, same tile. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "accent",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  emphasis?: boolean;
  icon?: IconName;
  tone?: "accent" | "green" | "amber" | "blue";
}) {
  return <Kpi label={label} value={value} foot={hint} icon={icon} tone={tone} />;
}

/** "▲ 12%" — `goodWhenDown` for costs, where a fall is the good news. */
export function Delta({ value, goodWhenDown = false, suffix = "" }: { value: number | null; goodWhenDown?: boolean; suffix?: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className="delta delta-flat">0%{suffix}</span>;
  const up = rounded > 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span className={`delta ${good ? "delta-good" : "delta-bad"}`}>
      <Icon name={up ? "trendUp" : "trendDown"} size={12} strokeWidth={2.2} />
      {Math.abs(rounded)}%{suffix}
    </span>
  );
}

export function Callout({
  icon = "info",
  tone = "accent",
  title,
  children,
  action,
  className = "",
}: {
  icon?: IconName;
  tone?: Tone;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`callout ${tone === "amber" ? "callout-warn" : tone === "accent" ? "callout-accent" : ""} ${className}`} style={toneVars(tone)}>
      <div className="callout-icon"><Icon name={icon} size={17} /></div>
      <div className="min-w-0 flex-1">
        <div className="callout-title">{title}</div>
        {children && <div className="callout-text">{children}</div>}
      </div>
      {action && <div className="shrink-0 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Avatar({ name, color, size = 34, round = false }: { name: string; color?: string; size?: number; round?: boolean }) {
  const initials = name
    .replace(/^administrator$/i, "Admin")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={`avatar ${round ? "avatar-round" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ...(color ? ({ "--av": color } as React.CSSProperties) : {}) }}
    >
      {initials || "A"}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card rise ${className}`}>{children}</div>;
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
      <div className="text-[15px] font-semibold">{title}</div>
      {description && <div className="mt-1 max-w-sm text-[13.5px] muted leading-relaxed">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FxBadge({ source, status }: { source: FxSource; status: ConversionStatus }) {
  const cls = status === "pending" ? "pill warn" : status === "exact" ? "pill ok" : "pill";
  return <span className={cls}>{fxSourceLabel(source)}</span>;
}
