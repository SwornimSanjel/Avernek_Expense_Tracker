export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-label="Avernek"
      role="img"
      className="logo-mark relative inline-block shrink-0"
      style={{
        width: size,
        height: size,
      }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="block overflow-visible">
        <defs>
          <linearGradient id="avernek-mark-gradient" x1="32" y1="4" x2="32" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#b481ff" />
            <stop offset="1" stopColor="#6d22e6" />
          </linearGradient>
        </defs>
        <path d="M3 60 25 4h9l-7 34h6.5c2 0 3.5 1.5 3.5 3.5v5c0 2-1.5 3.5-3.5 3.5h-9L21.5 60H3Z" fill="url(#avernek-mark-gradient)" />
        <path d="M61 60 39 4h-9l7 34h-6.5c-2 0-3.5 1.5-3.5 3.5v5c0 2 1.5 3.5 3.5 3.5h9l3 10H61Z" fill="url(#avernek-mark-gradient)" />
      </svg>
    </span>
  );
}

export function LogoWord({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo-word inline-flex items-center gap-2.5">
      <LogoMark size={30} />
      {!compact && (
        <span className="font-bold tracking-[-0.025em] text-[19px] leading-none">
          <span style={{ color: "#9a6bff" }}>A</span>vernek
        </span>
      )}
    </span>
  );
}
