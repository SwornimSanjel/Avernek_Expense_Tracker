"use client";

import { useState, useTransition } from "react";
import { removeMember, restoreMember, setMemberAccess, type MemberState } from "@/app/(app)/settings/actions";
import {
  EXPENSE_LEDGERS,
  LEDGER_LABELS,
  SECTIONS,
  type Access,
  type ExpenseLedger,
  type SectionKey,
} from "@/lib/access";
import Icon from "./Icons";

export type MemberAccessProps = {
  id: string;
  name: string;
  isAdmin: boolean;
  isSelf: boolean;
  removed: boolean;
  access: Access;
};

/**
 * One person's row controls in Settings → Team: what they can view, and
 * Remove / Restore. Removing only ends their sign-in; their money history
 * stays exactly as it is.
 */
export default function MemberAccess({ id, name, isAdmin, isSelf, removed, access }: MemberAccessProps) {
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<MemberState | null>(null);

  function run(action: () => Promise<MemberState>) {
    start(async () => {
      try {
        setMessage(await action());
      } catch (error) {
        setMessage({ error: error instanceof Error ? error.message : "Could not save. Try again.", ok: null });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {removed ? (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Let ${name} sign in again?`)) run(() => restoreMember(id));
          }}
        >
          <Icon name="refresh" size={14} /> Restore
        </button>
      ) : (
        <>
          {!isAdmin && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>
              <Icon name="shield" size={14} /> Edit access
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ color: "var(--red)" }}
              disabled={busy}
              onClick={() => {
                const ok = window.confirm(
                  `Remove ${name}?\n\nThey can no longer sign in. Every expense they paid, every split, contribution and investment stays exactly as it is, and you can restore them later.`
                );
                if (ok) run(() => removeMember(id));
              }}
            >
              <Icon name="trash" size={14} /> Remove
            </button>
          )}
        </>
      )}
      {message && !editing && (
        <p className={`basis-full text-right text-[12.5px] ${message.error ? "text-red" : "muted"}`}>{message.error ?? message.ok}</p>
      )}
      {editing && (
        <AccessEditor
          name={name}
          access={access}
          busy={busy}
          message={message}
          onClose={() => {
            setEditing(false);
            setMessage(null);
          }}
          onSave={(sections, expenses) =>
            start(async () => {
              try {
                const result = await setMemberAccess(id, sections, expenses);
                setMessage(result);
                if (!result.error) setEditing(false);
              } catch (error) {
                setMessage({ error: error instanceof Error ? error.message : "Could not save. Try again.", ok: null });
              }
            })
          }
        />
      )}
    </div>
  );
}

function AccessEditor({
  name,
  access,
  busy,
  message,
  onClose,
  onSave,
}: {
  name: string;
  access: Access;
  busy: boolean;
  message: MemberState | null;
  onClose: () => void;
  onSave: (sections: SectionKey[], expenses: ExpenseLedger[]) => void;
}) {
  const [sections, setSections] = useState<Set<SectionKey>>(() => new Set(access.sections));
  const [expenses, setExpenses] = useState<Set<ExpenseLedger>>(() => new Set(access.expenses));
  const allExpenses = EXPENSE_LEDGERS.every((ledger) => expenses.has(ledger));

  const flip = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel md:max-w-xl p-5 md:p-6 space-y-5 text-left" role="dialog" aria-label={`What ${name} can see`}>
        <div className="modal-header">
          <div>
            <h2>What {name} can see</h2>
            <p className="muted mt-1">Only what is ticked. Changes apply on their next page load.</p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setSections(new Set(SECTIONS.map((section) => section.key)));
              setExpenses(new Set(EXPENSE_LEDGERS));
            }}
          >
            Everything
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setSections(new Set());
              setExpenses(new Set());
            }}
          >
            Nothing
          </button>
        </div>

        <section className="space-y-2">
          <div className="field-label">Expenses</div>
          <div className="grid sm:grid-cols-3 gap-2">
            {EXPENSE_LEDGERS.map((ledger) => (
              <label key={ledger} className="checkbox-row">
                <input type="checkbox" checked={expenses.has(ledger)} onChange={() => setExpenses((current) => flip(current, ledger))} />
                <span>
                  <strong>{LEDGER_LABELS[ledger].label}</strong>
                  <small>{LEDGER_LABELS[ledger].hint}</small>
                </span>
              </label>
            ))}
          </div>
          <p className="field-help !mt-1">
            {expenses.size === 0 ? "No expenses: the Expenses page is hidden." : allExpenses ? "Every expense." : "Only these expenses, on the Expenses page and in its CSV."}
          </p>
        </section>

        <section className="space-y-2">
          <div className="field-label">Pages</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SECTIONS.map((section) => {
              const blocked = section.allExpenses && !allExpenses;
              return (
                <label key={section.key} className={`checkbox-row ${blocked ? "opacity-50 !cursor-not-allowed" : ""}`} title={blocked ? "Shows expenses from every account" : undefined}>
                  <input
                    type="checkbox"
                    disabled={blocked}
                    checked={!blocked && sections.has(section.key)}
                    onChange={() => setSections((current) => flip(current, section.key))}
                  />
                  <span>
                    <strong>{section.label}</strong>
                    {blocked && <small>Needs every expense</small>}
                  </span>
                </label>
              );
            })}
          </div>
          {!allExpenses && (
            <p className="field-help !mt-1">
              Greyed-out pages add up expenses from every account, so they open only for people who may see every expense.
            </p>
          )}
          <p className="field-help !mt-1">Ask AI is offered only to people who can see everything.</p>
        </section>

        {message?.error && (
          <p className="alert alert-error" role="alert">
            {message.error}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          className="btn btn-primary w-full !h-12"
          onClick={() =>
            onSave(
              [...sections].filter((key) => !(SECTIONS.find((section) => section.key === key)?.allExpenses && !allExpenses)),
              [...expenses]
            )
          }
        >
          {busy ? "Saving…" : "Save access"}
        </button>
      </div>
    </div>
  );
}
