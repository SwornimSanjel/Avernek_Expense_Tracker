"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Icon from "@/components/Icons";

/** Segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`seg ${className}`} role="tablist">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={on}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`seg-btn ${on ? "seg-btn-on" : ""} ${size === "sm" ? "!h-7 !px-2.5 !text-[13px]" : ""}`}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="seg-thumb" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs with an animated indicator. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
}) {
  const id = useId();
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={option.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(option.value)} className={`tab ${on ? "tab-on" : ""}`}>
            {option.label}
            {option.count != null && <span className="chip-count">{option.count}</span>}
            {on && <motion.span layoutId={`tab-${id}`} className="tab-line" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
          </button>
        );
      })}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A real calendar-year month picker: pick a year, then a month. Months that
 * have activity carry a dot; months after `maxKey` are disabled.
 */
export function MonthPicker({
  value,
  onChange,
  maxKey,
  marked,
  children,
}: {
  value: string;
  onChange: (key: string) => void;
  maxKey?: string;
  marked?: Set<string>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setYear(Number(value.slice(0, 4)));
    function onDoc(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, value]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="stmt-period-label rounded-lg hover:bg-[var(--hover)] h-9 inline-flex items-center justify-center gap-1.5" aria-haspopup="dialog" aria-expanded={open}>
        {children}
        <Icon name="chevronDown" size={15} className="muted" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute left-1/2 top-[calc(100%+6px)] z-40 w-[272px] -translate-x-1/2 card p-3"
            style={{ boxShadow: "var(--shadow-float)" }}
            role="dialog"
          >
            <div className="flex items-center justify-between mb-2">
              <button type="button" className="icon-btn !w-8 !h-8" onClick={() => setYear((y) => y - 1)} aria-label="Previous year"><Icon name="chevronLeft" size={15} /></button>
              <strong className="text-[15px] tnum">{year}</strong>
              <button
                type="button"
                className="icon-btn !w-8 !h-8"
                onClick={() => setYear((y) => y + 1)}
                disabled={maxKey ? year + 1 > Number(maxKey.slice(0, 4)) : false}
                aria-label="Next year"
              >
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((name, index) => {
                const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                const disabled = maxKey ? key > maxKey : false;
                const on = key === value;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    className={`relative h-10 rounded-lg text-[13.5px] font-medium transition-colors ${on ? "text-white" : disabled ? "opacity-35" : "hover:bg-[var(--hover)]"}`}
                    style={on ? { background: "var(--accent)" } : undefined}
                  >
                    {name}
                    {marked?.has(key) && !on && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: "var(--accent-ink)" }} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Spotlight that follows the cursor on `.glow-card` elements inside. */
export function GlowTracker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      onMouseMove={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>(".glow-card");
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        card.style.setProperty("--my", `${event.clientY - rect.top}px`);
      }}
    >
      {children}
    </div>
  );
}
