"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteIncomeAgreement,
  setIncomeAgreementStatus,
  updateIncomeAgreement,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import type { IncomeAgreement, MoneyAccount } from "@/lib/types";
import IncomeAgreementFields from "./IncomeAgreementFields";
import Icon from "./Icons";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Edit / pause / delete for one client. Every meaningful field stays editable
 * here — dates included — because a contract that changed in real life must be
 * correctable without recreating the client and losing its payment history.
 */
export default function IncomeAgreementControls({
  agreement,
  moneyAccounts,
  paymentCount,
  recurringPaymentCount = 0,
  redirectOnDelete,
}: {
  agreement: IncomeAgreement;
  moneyAccounts: MoneyAccount[];
  paymentCount: number;
  recurringPaymentCount?: number;
  redirectOnDelete?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, action, pending] = useActionState(updateIncomeAgreement, initialState);
  const [statusPending, startTransition] = useTransition();
  const wrapper = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state.ok]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <>
      <div className="relative" ref={wrapper}>
        <button
          disabled={statusPending}
          onClick={() => setMenuOpen((value) => !value)}
          className="icon-btn !w-9 !h-9"
          aria-label="Client actions"
        >
          <Icon name="more" size={17} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 z-20 w-52 card !rounded-xl p-1 text-xs shadow-xl">
            <button
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
              onClick={() => {
                setMenuOpen(false);
                setEditing(true);
              }}
            >
              Edit client &amp; services
            </button>
            {agreement.status === "active" ? (
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
                onClick={() =>
                  startTransition(async () => {
                    await setIncomeAgreementStatus(agreement.id, "paused");
                    setMenuOpen(false);
                  })
                }
              >
                Pause services
              </button>
            ) : (
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
                onClick={() =>
                  startTransition(async () => {
                    await setIncomeAgreementStatus(agreement.id, "active");
                    setMenuOpen(false);
                  })
                }
              >
                Set back to active
              </button>
            )}
            {agreement.status !== "completed" && (
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
                onClick={() => {
                  if (!window.confirm("Mark this client completed and stop future recurring dues? All history is kept."))
                    return;
                  startTransition(async () => {
                    await setIncomeAgreementStatus(agreement.id, "completed");
                    setMenuOpen(false);
                  });
                }}
              >
                Complete service
              </button>
            )}
            <div className="my-1 border-t" style={{ borderColor: "var(--line)" }} />
            <button
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
              style={{ color: "var(--red)" }}
              onClick={() => {
                const paymentWarning = paymentCount > 0
                  ? ` and its ${paymentCount} payment record${paymentCount === 1 ? "" : "s"}`
                  : "";
                if (
                  !window.confirm(
                    `Delete ${agreement.client_name}${paymentWarning}? This removes its receipts from the account balance and cannot be undone.`
                  )
                )
                  return;
                startTransition(async () => {
                  try {
                    await deleteIncomeAgreement(agreement.id);
                    setMenuOpen(false);
                    if (redirectOnDelete) router.push(redirectOnDelete);
                  } catch (error) {
                    window.alert(
                      error instanceof Error ? error.message : "Could not delete this client."
                    );
                  }
                });
              }}
            >
              Delete client &amp; agreement
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-3xl p-5 md:p-6 space-y-4">
            <input type="hidden" name="agreement_id" value={agreement.id} />
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Edit {agreement.client_name}</h2>
                <p className="text-xs muted">
                  Payments already recorded are kept. Amounts paid and remaining balances are always calculated from those records.
                </p>
              </div>
              <button type="button" onClick={() => setEditing(false)} className="icon-btn">
                ✕
              </button>
            </div>
            <IncomeAgreementFields
              agreement={agreement}
              moneyAccounts={moneyAccounts}
              recurringPaymentCount={recurringPaymentCount}
            />
            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : "Save changes"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
