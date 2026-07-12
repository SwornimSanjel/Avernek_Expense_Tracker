/**
 * Avernek logo mark — white wordmark, blue "A".
 * Placeholder drawn from description; swap the <svg> for the real asset when provided.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Avernek"
    >
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path
        d="M16 7 L24.5 25 H20.8 L16 14.2 L11.2 25 H7.5 Z"
        fill="var(--accent)"
      />
      <rect x="12.4" y="19.4" width="7.2" height="2.6" rx="1.3" fill="var(--bg)" />
    </svg>
  );
}

export function LogoWord({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <span className="font-bold tracking-tight text-lg leading-none">
          <span style={{ color: "var(--accent)" }}>A</span>vernek
        </span>
      )}
    </span>
  );
}
