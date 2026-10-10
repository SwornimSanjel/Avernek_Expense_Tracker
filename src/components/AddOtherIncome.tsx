"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  addOtherIncome,
  deleteOtherIncome,
  updateOtherIncome,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import { OTHER_INCOME_LABELS, PAYMENT_METHOD_LABELS, todayIso } from "@/lib/income";
import { accountShortName } from "@/lib/funds";
import type { MoneyAccount, OtherIncome, OtherIncomeCategory } from "@/lib/types";
import TaxBreakdownFields from "./TaxBreakdownFields";
import Icon from "./Icons";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Money earned without a client agreement: a quick website for someone who
 * never signed, extra work, consulting. It is income (unlike “Add funds”, which
 * is capital) and it never needs a fake client.
 */
export default function AddOtherIncome({
  accounts,
  record,
  compact,
}: {
  accounts: MoneyAccount[];
  record?: OtherIncome;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    record ? updateOtherIncome : addOtherIncome,
    initialState
  );
  const active = accounts.filter((account) => account.is_active);
  const [accountId, setAccountId] = useState(record?.money_account_id ?? active[0]?.id ?? "");
  const account = active.find((item) => item.id === accountId);
  const [deleting, startDelete] = useTransition();

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      {record ? (
        <span className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => setOpen(true)} className="icon-btn !w-8 !h-8" aria-label="Edit income">
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() =>
              window.confirm("Delete this income record? The account balance goes down by it.") &&
              startDelete(() => deleteOtherIncome(record.id))
            }
            className="icon-btn !w-8 !h-8"
            style={{ color: "var(--red)" }}
            aria-label="Delete income"
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`btn ${compact ? "!h-9 !px-3 text-sm" : ""}`}>
          <span className="text-base leading-none">＋</span> Income without client
        </button>
      )}

      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-xl p-5 md:p-6 space-y-4">
            {record && <input type="hidden" name="income_id" value={record.id} />}
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">{record ? "Edit income" : "Add income without a client"}</h2>
                <p className="text-xs muted">
                  Extra work, a one-off website, consulting — anything earned outside a client agreement.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">
                ✕
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">What was it for?</span>
                <input
                  name="description"
                  required
                  defaultValue={record?.description ?? ""}
                  placeholder="e.g. Landing page for Cafe Mitra"
                  className="input mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Paid by (optional)</span>
                <input
                  name="source_name"
                  defaultValue={record?.source_name ?? ""}
                  placeholder="Person or company"
                  className="input mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Type</span>
                <select name="category" defaultValue={record?.category ?? "extra_work"} className="input mt-1">
                  {(Object.keys(OTHER_INCOME_LABELS) as OtherIncomeCategory[]).map((category) => (
                    <option key={category} value={category}>
                      {OTHER_INCOME_LABELS[category]}
                    </option>
                  ))}
                </select>
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

            <div>
              <span className="field-label">Landed in</span>
              <div className="choice-grid mt-2">
                {active.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAccountId(item.id)}
                    className={`funding-choice ${accountId === item.id ? "funding-choice-active" : ""}`}
                  >
                    <strong>{accountShortName(item)}</strong>
                    <span>
                      {item.name} · {item.currency}
                    </span>
                  </button>
                ))}
              </div>
              <input type="hidden" name="money_account_id" value={accountId} />
            </div>

            <TaxBreakdownFields
              currency={account?.currency ?? "NPR"}
              vatSuggested={account?.kind === "company_bank"}
              record={
                record
                  ? {
                      amount: Number(record.amount),
                      vat: Number(record.vat_amount),
                      tds: Number(record.tds_amount),
                    }
                  : undefined
              }
            />

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">Method (optional)</span>
                <select name="method" defaultValue={record?.method ?? "bank_transfer"} className="input mt-1">
                  <option value="">Not recorded</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Reference (optional)</span>
                <input name="reference" defaultValue={record?.reference ?? ""} className="input mt-1" />
              </label>
            </div>
            <label className="block">
              <span className="field-label">Note (optional)</span>
              <input name="note" defaultValue={record?.note ?? ""} className="input mt-1" />
            </label>

            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending || !accountId} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : record ? "Save changes" : "Record income"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
