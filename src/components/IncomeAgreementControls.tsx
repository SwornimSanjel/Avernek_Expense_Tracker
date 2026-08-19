"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  setIncomeAgreementStatus,
  updateIncomeAgreement,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import type { IncomeAgreement, MoneyAccount } from "@/lib/types";
import IncomeAgreementFields from "./IncomeAgreementFields";
import Icon from "./Icons";

const initialState: IncomeFormState = { error: null, ok: null };

export default function IncomeAgreementControls({
  agreement,
  moneyAccounts,
}: {
  agreement: IncomeAgreement;
  moneyAccounts: MoneyAccount[];
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, action, pending] = useActionState(updateIncomeAgreement, initialState);
  const [statusPending, startTransition] = useTransition();

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state.ok]);

  return (
    <>
      <div className="relative" onMouseLeave={() => setMenuOpen(false)}>
        <button disabled={statusPending} onClick={() => setMenuOpen((value) => !value)} className="icon-btn !w-9 !h-9" aria-label="Agreement actions">
          <Icon name="more" size={17} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 z-20 w-44 card !rounded-xl p-1 text-xs shadow-xl">
            <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]" onClick={() => { setMenuOpen(false); setEditing(true); }}>Edit agreement</button>
            {agreement.status === "active" ? (
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]" style={{ color: "var(--red)" }} onClick={() => {
                if (!window.confirm("End this agreement and stop future recurring dues?")) return;
                startTransition(async () => { await setIncomeAgreementStatus(agreement.id, "completed"); setMenuOpen(false); });
              }}>End service</button>
            ) : (
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]" onClick={() => startTransition(async () => { await setIncomeAgreementStatus(agreement.id, "active"); setMenuOpen(false); })}>Reactivate service</button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop">
          <form
            action={action}
            className="modal-panel md:max-w-3xl p-5 md:p-6 space-y-4"
          >
            <input type="hidden" name="agreement_id" value={agreement.id} />
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Edit agreement</h2>
                <p className="text-xs muted">Payments already recorded are kept.</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} className="icon-btn">✕</button>
            </div>
            <IncomeAgreementFields agreement={agreement} moneyAccounts={moneyAccounts} />
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
