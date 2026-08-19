export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-label="Avernek"
      role="img"
      className="relative inline-block shrink-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, size * 0.28),
        border: "1px solid rgb(139 92 246 / 0.24)",
        background: "#0b0911",
        boxShadow: "0 8px 22px rgb(87 43 176 / 0.2), 0 1px 0 rgb(255 255 255 / 0.08) inset",
      }}
    >
      <img
        src="/avernek-logo.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
        style={{ width: size * 2.38, height: size * 2.38 }}
      />
    </span>
  );
}

export function LogoWord({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={30} />
      {!compact && (
        <span className="font-bold tracking-[-0.025em] text-[19px] leading-none">
          <span style={{ color: "#9a6bff" }}>A</span>vernek
        </span>
      )}
    </span>
  );
}
