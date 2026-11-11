"use client";

import Icon from "@/components/Icons";
import { guardRequest } from "@/lib/stale-deploy";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  addCapitalInflow,
  deleteCapitalInflow,
  updateCapitalInflow,
  type FundsFormState,
} from "@/app/(app)/funds/actions";
import { CAPITAL_INFLOW_LABELS, todayIso } from "@/lib/income";
import type { CapitalInflow, CapitalInflowType, MoneyAccount } from "@/lib/types";

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
  record,
}: {
  accounts: MoneyAccount[];
  defaultAccountId?: string;
  label?: string;
  compact?: boolean;
  /** An existing record: shows Edit + Delete buttons instead of "Add funds". */
  record?: CapitalInflow;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    guardRequest(record ? updateCapitalInflow : addCapitalInflow),
    initialState
  );
  const [deleting, startDelete] = useTransition();

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open) {
    if (record) {
      return (
        <span className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="icon-btn !w-8 !h-8"
            aria-label="Edit these funds"
            title="Edit"
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() =>
              window.confirm(
                `Delete this ${Number(record.amount).toLocaleString("en-IN")} entry? The account balance goes down by it.`
              ) && startDelete(() => deleteCapitalInflow(record.id))
            }
            className="icon-btn !w-8 !h-8"
            style={{ color: "var(--red)" }}
            aria-label="Delete these funds"
            title="Delete"
          >
            {deleting ? "…" : <Icon name="trash" size={14} />}
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn ${compact ? "!h-9 !px-3 text-sm" : ""}`}
      >
        <Icon name="plus" size={15} /> {label}
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
        {record && <input type="hidden" name="inflow_id" value={record.id} />}
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">{record ? "Edit funds" : "Add funds to an account"}</h2>
            <p className="text-[13px] muted">
              Money that was not earned from a client. It changes the balance only.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn"><Icon name="close" size={16} /></button>
        </div>

        <label className="block">
          <span className="field-label">Transaction type</span>
          <select name="inflow_type" defaultValue={record?.inflow_type ?? "founder_investment"} className="input mt-1">
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
              defaultValue={record ? String(Number(record.amount)) : undefined}
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
              defaultValue={record?.received_on ?? todayIso()}
              className="input mt-1"
            />
          </label>
        </div>

        <label className="block">
          <span className="field-label">Destination account</span>
          <select
            name="money_account_id"
            required
            defaultValue={record?.money_account_id ?? defaultAccountId ?? ""}
            className="input mt-1"
          >
            <option value="" disabled>
              Choose account
            </option>
            {accounts
              .filter((account) => account.is_active || account.id === record?.money_account_id)
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
            <input name="source_name" defaultValue={record?.source_name ?? ""} placeholder="e.g. Swornim" className="input mt-1" />
          </label>
          <label className="block">
            <span className="field-label">Reference (optional)</span>
            <input name="reference" defaultValue={record?.reference ?? ""} placeholder="Transaction ID" className="input mt-1" />
          </label>
        </div>

        <label className="block">
          <span className="field-label">Note (optional)</span>
          <input name="note" defaultValue={record?.note ?? ""} placeholder="Why the money was put in" className="input mt-1" />
        </label>

        <p className="text-[13px] muted">
          Recorded under Capital / financing. It never appears as client income, sales, VAT
          taxable sales or profit.
        </p>

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : record ? "Save changes" : "Add funds"}
        </button>
      </form>
    </div>
  );
}
