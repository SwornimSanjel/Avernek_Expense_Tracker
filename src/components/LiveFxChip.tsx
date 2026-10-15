"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { MarketRate } from "@/lib/market-fx";

const REFRESH_MS = 5 * 60 * 1000;

function timeAgo(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}

/**
 * Live USD → NPR chip. Starts from the server's cached rate, then re-reads
 * /api/fx/live every few minutes and whenever the tab regains focus.
 */
export default function LiveFxChip({ initial }: { initial: MarketRate | null }) {
  const [rate, setRate] = useState(initial);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const response = await fetch("/api/fx/live", { cache: "no-store" });
        const next = (await response.json()) as MarketRate;
        if (alive && next?.rate) setRate(next);
      } catch {}
      if (alive) setNow(Date.now());
    }
    const timer = window.setInterval(refresh, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!rate) return null;
  const change = rate.changePct;

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button type="button" className="fx-chip" onClick={() => setOpen((value) => !value)} aria-label="USD to NPR live rate">
        <span className="fx-live" />
        <span className="muted">USD</span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.strong
            key={rate.rate.toFixed(2)}
            className="tnum text-[15px]"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            NPR {rate.rate.toFixed(2)}
          </motion.strong>
        </AnimatePresence>
        {change != null && Math.abs(change) >= 0.005 && (
          <span className={`tnum text-[12.5px] font-semibold ${change > 0 ? "text-red" : "text-green"}`}>
            {change > 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fx-pop"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
          >
            <div className="flex items-center justify-between">
              <strong className="text-[14px]">1 USD = NPR {rate.rate.toFixed(4)}</strong>
              <span className="pill ok">Live</span>
            </div>
            <p className="mt-1 text-[13px] muted">
              {rate.sourceLabel} mid-market rate · updated {timeAgo(rate.fetchedAt, now)}. Refreshes every 5 minutes.
            </p>
            {rate.change != null && (
              <p className="mt-2 text-[13px]">
                Since yesterday&apos;s close: <span className={rate.change > 0 ? "text-red" : "text-green"}>{rate.change > 0 ? "+" : "−"}{Math.abs(rate.change).toFixed(4)}</span>
              </p>
            )}
            {rate.nrb && (
              <div className="mt-3 pt-3 border-t text-[13px]">
                <div className="flex justify-between"><span className="muted">NRB sell ({rate.nrb.date})</span><strong className="tnum">{rate.nrb.sell.toFixed(2)}</strong></div>
                {rate.nrb.buy != null && <div className="flex justify-between mt-1"><span className="muted">NRB buy</span><strong className="tnum">{rate.nrb.buy.toFixed(2)}</strong></div>}
                <p className="mt-2 muted-2 text-[12.5px]">USD bills are converted at the NRB sell rate for their date — that is what the bank charges.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
