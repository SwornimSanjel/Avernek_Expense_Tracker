export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-label="Avernek"
      role="img"
      className="relative inline-block shrink-0 overflow-hidden bg-white"
      style={{ width: size, height: size, borderRadius: Math.max(6, size * 0.22) }}
    >
      <img
        src="/avernek-logo.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
        style={{ width: size * 2.55, height: size * 2.55 }}
      />
    </span>
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
