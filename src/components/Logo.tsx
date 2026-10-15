import { useId } from "react";

/**
 * The official Avernek mark, traced 1:1 from the brand file (1024×1024 art,
 * mark spans x 308–716, y 320–700): two tapered legs, each with a small
 * rounded tab at mid-height, on the brand's violet gradient. Drawn as SVG so
 * it stays sharp at every size and needs no white or dark backing square.
 */
export const LOGO_LEFT =
  "M468 320H504L480.42 480H492a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H473.05L448 700H308Z";
export const LOGO_RIGHT =
  "M556 320H520L543.58 480H532a10 10 0 0 0-10 10v30a10 10 0 0 0 10 10h18.95L576 700H716Z";

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="298 300 428 420"
      width={size}
      height={size}
      role="img"
      aria-label="Avernek"
      className={`logo-mark shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={`avk-${id}`} x1="0" y1="320" x2="0" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A274FF" />
          <stop offset="0.48" stopColor="#8A3FFC" />
          <stop offset="1" stopColor="#5B1EB3" />
        </linearGradient>
      </defs>
      <path d={LOGO_LEFT} fill={`url(#avk-${id})`} />
      <path d={LOGO_RIGHT} fill={`url(#avk-${id})`} />
    </svg>
  );
}

export function LogoWord({ compact = false, size = 26 }: { compact?: boolean; size?: number }) {
  return (
    <span className="logo-word inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      {!compact && <span className="logo-text">Avernek</span>}
    </span>
  );
}
