"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updateIncomePayment,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import type { Currency, IncomePayment, MoneyAccount } from "@/lib/types";
import Icon from "./Icons";

const initialState: IncomeFormState = { error: null, ok: null };

export default function EditIncomePayment({
  payment,
  currency,
  moneyAccounts,
}: {
  payment: IncomePayment;
  currency: Currency;
  moneyAccounts: MoneyAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateIncomePayment, initialState);
  const matchingAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === currency
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="icon-btn !w-8 !h-8"
        aria-label="Edit payment and receiving account"
      >
        <Icon name="edit" size={15} />
      </button>

      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-xl p-5 md:p-6 space-y-4">
            <input type="hidden" name="payment_id" value={payment.id} />
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Edit payment</h2>
                <p className="text-xs muted">Change the amount, date, or bank that received it.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">✕</button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Amount</span>
                <input name="amount" type="number" min="0.01" step="0.01" required defaultValue={Number(payment.amount)} className="input mt-1 tnum" />
              </label>
              <label className="block">
                <span className="field-label">Paid date</span>
                <input name="paid_on" type="date" required defaultValue={payment.paid_on} className="input mt-1" />
              </label>
            </div>

            <label className="block">
              <span className="field-label">Received in</span>
              <select name="money_account_id" required defaultValue={payment.money_account_id ?? ""} className="input mt-1">
                <option value="" disabled>Choose receiving account</option>
                {matchingAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Reference</span>
                <input name="reference" defaultValue={payment.reference ?? ""} className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Note</span>
                <input name="note" defaultValue={payment.note ?? ""} className="input mt-1" />
              </label>
            </div>

            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : "Save payment changes"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
