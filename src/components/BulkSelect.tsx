"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { BulkResult } from "@/lib/bulk";
import Icon from "./Icons";

/**
 * Select several records and delete them at once. Wrap a list in BulkSelect,
 * put a SelectToggle where the "Select" button belongs, a SelectBox at the
 * start of each row and, optionally, a SelectGroup in each month heading.
 * Nothing shows until "Select" is pressed; then a bar floats at the bottom with
 * Select all, the count and Delete. Shift-click selects a range.
 *
 * Rows are usually rendered on the server: these pieces only need the ids.
 */

type Noun = { one: string; many: string };

type Selection = {
  active: boolean;
  selected: Set<string>;
  /** Records the list's rules protect, with why. */
  locked: Record<string, string>;
  toggle: (id: string, range: boolean) => void;
  setGroup: (ids: string[], on: boolean) => void;
  start: () => void;
  stop: () => void;
};

const BulkContext = createContext<Selection | null>(null);

export default function BulkSelect({
  ids,
  locked = {},
  noun,
  onDelete,
  children,
}: {
  /** Every record in the list, in the order shown (for Select all and Shift-click). */
  ids: string[];
  locked?: Record<string, string>;
  noun: Noun;
  /** The list's bulk delete action; without it (not allowed) nothing is selectable. */
  onDelete?: (ids: string[]) => Promise<BulkResult>;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const last = useRef<string | null>(null);
  const open = useMemo(() => ids.filter((id) => !locked[id]), [ids, locked]);

  useEffect(() => setMounted(true), []);

  const stop = useCallback(() => {
    setActive(false);
    setSelected(new Set());
    last.current = null;
  }, []);

  // Rows that leave the list (deleted, filtered away) leave the selection too.
  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((id) => ids.includes(id)));
      return next.size === current.size ? current : next;
    });
  }, [ids]);

  // While selecting: Escape cancels, and the Ask AI button steps aside for the bar.
  useEffect(() => {
    if (!active) return;
    document.body.classList.add("bulk-selecting");
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && stop();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bulk-selecting");
      window.removeEventListener("keydown", onKey);
    };
  }, [active, stop]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const toggle = useCallback(
    (id: string, range: boolean) => {
      if (locked[id]) return;
      // Read the range now: the update below runs later, after `last` moves on.
      const from = range && last.current ? ids.indexOf(last.current) : -1;
      const to = ids.indexOf(id);
      const span = from >= 0 && to >= 0 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
      setSelected((current) => {
        const next = new Set(current);
        const on = !current.has(id);
        for (const key of span) {
          if (locked[key]) continue;
          if (on) next.add(key);
          else next.delete(key);
        }
        return next;
      });
      last.current = id;
    },
    [ids, locked]
  );

  const setGroup = useCallback(
    (group: string[], on: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        for (const id of group) {
          if (locked[id]) continue;
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    [locked]
  );

  function remove() {
    const chosen = [...selected];
    if (!chosen.length || !onDelete) return;
    const what = chosen.length === 1 ? `1 ${noun.one}` : `${chosen.length} ${noun.many}`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        const result = await onDelete(chosen);
        setMessage(result.message);
        stop();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete. Try again.");
      }
    });
  }

  const value = useMemo<Selection>(
    () => ({
      active,
      selected,
      locked,
      toggle,
      setGroup,
      start: () => {
        setMessage(null);
        setActive(true);
      },
      stop,
    }),
    [active, selected, locked, toggle, setGroup, stop]
  );
  const allOn = open.length > 0 && open.every((id) => selected.has(id));

  return (
    <BulkContext.Provider value={onDelete ? value : null}>
      {children}
      {mounted &&
        (active || message) &&
        createPortal(
          <div className="bulk-bar" role="toolbar" aria-label={`Selected ${noun.many}`}>
            {active ? (
              <>
                <div className="bulk-info">
                  <label className="bulk-all">
                    <input type="checkbox" checked={allOn} disabled={!open.length} onChange={(event) => setGroup(open, event.target.checked)} />
                    Select all {open.length}
                  </label>
                  <span className="bulk-count">{selected.size} selected</span>
                </div>
                <div className="bulk-actions">
                  <button type="button" className="btn btn-danger btn-sm" disabled={!selected.size || pending} onClick={remove}>
                    <Icon name="trash" size={15} /> {pending ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={stop} disabled={pending}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <span className="bulk-message" role="status">
                <Icon name="check" size={16} /> {message}
              </span>
            )}
          </div>,
          document.body
        )}
    </BulkContext.Provider>
  );
}

/** The "Select" button; renders nothing where deleting is not allowed. */
export function SelectToggle({ className = "" }: { className?: string }) {
  const selection = useContext(BulkContext);
  if (!selection) return null;
  return (
    <button
      type="button"
      className={`btn btn-sm ${selection.active ? "btn-ghost" : ""} ${className}`}
      onClick={selection.active ? selection.stop : selection.start}
      aria-pressed={selection.active}
    >
      <Icon name={selection.active ? "close" : "check"} size={15} /> {selection.active ? "Done" : "Select"}
    </button>
  );
}

/** A row's checkbox, shown only while selecting. */
export function SelectBox({ id, label }: { id: string; label?: string }) {
  const selection = useContext(BulkContext);
  if (!selection?.active) return null;
  const reason = selection.locked[id];
  return (
    <label className="bulk-box" title={reason ?? undefined}>
      <input
        type="checkbox"
        checked={selection.selected.has(id)}
        disabled={Boolean(reason)}
        aria-label={reason ? `Cannot be deleted: ${reason}` : `Select ${label ?? "this record"}`}
        // The click carries the Shift key (a change event does not); Space fires a click too.
        onClick={(event) => selection.toggle(id, event.shiftKey)}
        readOnly
      />
    </label>
  );
}

/** A month heading's checkbox: selects or clears every row under it. */
export function SelectGroup({ ids, label }: { ids: string[]; label: string }) {
  const selection = useContext(BulkContext);
  const ref = useRef<HTMLInputElement>(null);
  const open = selection ? ids.filter((id) => !selection.locked[id]) : [];
  const count = selection ? open.filter((id) => selection.selected.has(id)).length : 0;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < open.length;
  }, [count, open.length]);
  if (!selection?.active) return null;
  return (
    <input
      ref={ref}
      type="checkbox"
      className="bulk-group"
      checked={open.length > 0 && count === open.length}
      disabled={!open.length}
      aria-label={`Select every row in ${label}`}
      onChange={(event) => selection.setGroup(open, event.target.checked)}
    />
  );
}
