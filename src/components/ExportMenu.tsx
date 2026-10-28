"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icons";

export type ExportChoice = {
  label: string;
  /** Second line, e.g. "October 2026 · 16 rows". */
  hint?: string;
  href: string;
};

/**
 * "Export CSV" with the periods people actually want, one click each. Every
 * option is a plain download link: the file opens in Excel or Google Sheets
 * with readable column names and a total at the bottom.
 */
export default function ExportMenu({ choices, label = "Export CSV" }: { choices: ExportChoice[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="download" size={14} /> {label}
        <Icon name="chevronDown" size={13} className={`muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="menu-pop export-menu" role="menu">
          {choices.map((choice) => (
            <a key={choice.href} href={choice.href} role="menuitem" className="menu-item" download onClick={() => setOpen(false)}>
              <Icon name="download" size={15} className="muted" />
              <span className="min-w-0">
                <span className="block font-medium">{choice.label}</span>
                {choice.hint && <span className="block text-[12.5px] muted truncate">{choice.hint}</span>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
