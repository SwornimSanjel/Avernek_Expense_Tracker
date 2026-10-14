"use client";

import { useActionState, useEffect, useState } from "react";
import {
  addMoneyAccount,
  type FundsFormState,
} from "@/app/(app)/funds/actions";
import type { MoneyAccountKind } from "@/lib/types";

const initialState: FundsFormState = { error: null, ok: null };

export default function AddMoneyAccount() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MoneyAccountKind>("digital_wallet");
  const [state, action, pending] = useActionState(addMoneyAccount, initialState);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn">＋ Account</button>
      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Add company-money account</h2>
                <p className="text-xs muted mt-1">Bank, custody account, wallet, or company cash.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">✕</button>
            </div>
            <label className="block">
              <span className="field-label">Account name</span>
              <input name="name" required autoFocus placeholder="e.g. USD prepaid wallet" className="input mt-1" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Account type</span>
                <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as MoneyAccountKind)} className="input mt-1">
                  <option value="company_bank">Official company bank</option>
                  <option value="personal_custody">Personally held · company money</option>
                  <option value="digital_wallet">Digital wallet / prepaid</option>
                  <option value="cash">Company cash</option>
                </select>
              </label>
              <label className="block">
                <span className="field-label">Currency</span>
                <select name="currency" defaultValue="USD" className="input mt-1">
                  <option value="NPR">NPR</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="field-label">Legal holder {kind === "personal_custody" ? "(required)" : "(optional)"}</span>
              <input name="holder_name" required={kind === "personal_custody"} placeholder={kind === "personal_custody" ? "e.g. Swornim Sanjel" : "e.g. Avernek"} className="input mt-1" />
            </label>
            <label className="block">
              <span className="field-label">Note (optional)</span>
              <input name="notes" placeholder="What this balance is used for" className="input mt-1" />
            </label>
            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending} className="btn btn-primary w-full !h-12">{pending ? "Adding…" : "Add account"}</button>
          </form>
        </div>
      )}
    </>
  );
}
