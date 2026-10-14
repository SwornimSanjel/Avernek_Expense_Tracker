"use client";

import { useActionState, useEffect, useState } from "react";
import { addCapitalInflow, type FundsFormState } from "@/app/(app)/funds/actions";
import { CAPITAL_INFLOW_LABELS, todayIso } from "@/lib/income";
import type { CapitalInflowType, MoneyAccount } from "@/lib/types";

const initialState: FundsFormState = { error: null, ok: null };

/**
 * Put non-client money into an account: founder capital, an owner
 * contribution, a loan. It raises the balance and is deliberately kept out of
 * revenue, client income, VAT sales and profit, so correcting a bank balance
 * never means inventing a client.
 */
export default function AddAccountFunds({
  accounts,
  defaultAccountId,
  label = "Add funds",
  compact,
}: {
  accounts: MoneyAccount[];
  defaultAccountId?: string;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addCapitalInflow, initialState);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn ${compact ? "!h-9 !px-3 text-sm" : ""}`}
      >
        <span className="text-base leading-none">＋</span> {label}
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Add funds to an account</h2>
            <p className="text-xs muted">
              Money that was not earned from a client. It changes the balance only.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        <label className="block">
          <span className="field-label">Transaction type</span>
          <select name="inflow_type" defaultValue="founder_investment" className="input mt-1">
            {(Object.keys(CAPITAL_INFLOW_LABELS) as CapitalInflowType[]).map((type) => (
              <option key={type} value={type}>
                {CAPITAL_INFLOW_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">Amount</span>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="10000"
              className="input tnum mt-1"
            />
          </label>
          <label className="block">
            <span className="field-label">Date received</span>
            <input
              name="received_on"
              type="date"
              required
              defaultValue={todayIso()}
              className="input mt-1"
            />
          </label>
        </div>

        <label className="block">
          <span className="field-label">Destination account</span>
          <select
            name="money_account_id"
            required
            defaultValue={defaultAccountId ?? ""}
            className="input mt-1"
          >
            <option value="" disabled>
              Choose account
            </option>
            {accounts
              .filter((account) => account.is_active)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.kind === "company_bank"
                    ? "VAT account"
                    : account.kind === "personal_custody"
                      ? "Non-VAT account"
                      : account.name}{" "}
                  · {account.name} ({account.currency})
                </option>
              ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">Funding source (optional)</span>
            <input name="source_name" placeholder="e.g. Swornim" className="input mt-1" />
          </label>
          <label className="block">
            <span className="field-label">Reference (optional)</span>
            <input name="reference" placeholder="Transaction ID" className="input mt-1" />
          </label>
        </div>

        <label className="block">
          <span className="field-label">Note (optional)</span>
          <input name="note" placeholder="Why the money was put in" className="input mt-1" />
        </label>

        <p className="text-xs muted">
          Recorded under Capital / financing. It never appears as client income, sales, VAT
          taxable sales or profit.
        </p>

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Add funds"}
        </button>
      </form>
    </div>
  );
}
