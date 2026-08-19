"use client";

import { useActionState, useEffect, useState } from "react";
import {
  addIncomeAgreement,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import IncomeAgreementFields from "./IncomeAgreementFields";
import type { MoneyAccount } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

export default function AddIncomeAgreement({ moneyAccounts }: { moneyAccounts: MoneyAccount[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addIncomeAgreement, initialState);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <span className="text-base leading-none">＋</span> Add client
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form
        action={action}
        className="modal-panel md:max-w-3xl p-5 md:p-6 space-y-4"
      >
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">New client agreement</h2>
            <p className="text-xs muted">Ads / automation live is Service Day 1. Recurring billing starts 30 days after the first setup payment date.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        <IncomeAgreementFields includeInitialPayment moneyAccounts={moneyAccounts} />

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Save agreement"}
        </button>
      </form>
    </div>
  );
}
