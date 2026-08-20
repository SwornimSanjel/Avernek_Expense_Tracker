"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setIncomeAgreementStatus } from "@/app/(app)/income/actions";
import Icon from "@/components/Icons";
import type { IncomeAgreementStatus } from "@/lib/types";

const options: {
  value: IncomeAgreementStatus;
  label: string;
  description: string;
  color: string;
}[] = [
  { value: "active", label: "Active", description: "Currently working", color: "var(--green)" },
  { value: "paused", label: "Paused", description: "Temporarily on hold", color: "var(--amber)" },
  { value: "completed", label: "Inactive", description: "Work has ended", color: "var(--muted)" },
];

export default function ClientStatusControl({
  agreementId,
  status,
}: {
  agreementId: string;
  status: IncomeAgreementStatus;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapper = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === status) ?? options[0];

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function changeStatus(next: IncomeAgreementStatus) {
    if (next === status) {
      setOpen(false);
      return;
    }
    if (
      next === "completed" &&
      !window.confirm("Mark this client inactive? Future recurring dues will stop, but all payments and history will remain.")
    ) return;

    startTransition(async () => {
      try {
        await setIncomeAgreementStatus(agreementId, next);
        setOpen(false);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not update the client status.");
      }
    });
  }

  return (
    <div ref={wrapper} className="relative shrink-0">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className="status-control-trigger inline-flex min-w-[138px] items-center gap-3 rounded-xl border px-3 text-left transition hover:-translate-y-px disabled:opacity-50"
        style={{ borderColor: "var(--line-strong)", background: "var(--surface-2)" }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] muted leading-none">Status</span>
          <span className="mt-1.5 flex items-center gap-2 text-xs font-semibold leading-none">
            <span className="client-status-dot" style={{ background: current.color }} />
            <span>{pending ? "Updating…" : current.label}</span>
          </span>
        </span>
        <Icon name="chevronDown" size={14} className={`muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[244px] rounded-2xl border p-2 shadow-2xl"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface)", boxShadow: "var(--shadow-float)" }}
          role="menu"
        >
          <div className="px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] muted">Change client status</div>
          <div className="space-y-1">
            {options.map((option) => {
              const selected = option.value === status;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  onClick={() => changeStatus(option.value)}
                  className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
                  style={{
                    borderColor: selected ? "color-mix(in srgb, var(--accent) 32%, var(--line))" : "transparent",
                    background: selected ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <span className="client-status-dot" style={{ background: option.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{option.label}</span>
                    <span className="block text-[11px] muted mt-1 leading-relaxed">{option.description}</span>
                  </span>
                  {selected && <span className="grid h-6 w-6 place-items-center rounded-lg" style={{ background: "var(--surface)" }}><Icon name="check" size={13} /></span>}
                </button>
              );
            })}
          </div>
          <p className="mx-2 mt-2 border-t pt-2 text-[10px] leading-relaxed muted" style={{ borderColor: "var(--line)" }}>
            Inactive stops future recurring dues and keeps the complete history.
          </p>
        </div>
      )}
    </div>
  );
}
