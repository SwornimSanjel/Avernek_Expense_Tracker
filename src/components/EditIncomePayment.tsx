"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updateIncomePayment,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import { PAYMENT_METHOD_LABELS, formatIncomeMoney, periodLabel, type RecurringPeriod } from "@/lib/income";
import type { Currency, IncomePayment, MoneyAccount } from "@/lib/types";
import Icon from "./Icons";
import TaxBreakdownFields from "./TaxBreakdownFields";
import { VatBillDocuments } from "./DocumentSections";
import type { Attachment } from "@/lib/attachments";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Correct a recorded payment. Amount, date, receiving account, method, note and
 * — for a monthly payment — the cycle it settles can all change; the balances
 * recalculate from the payment set, never from a stored total.
 */
export default function EditIncomePayment({
  payment,
  currency,
  moneyAccounts,
  periods = [],
  vatBills = [],
}: {
  payment: IncomePayment;
  currency: Currency;
  moneyAccounts: MoneyAccount[];
  periods?: RecurringPeriod[];
  /** VAT bills already saved on this payment. */
  vatBills?: Attachment[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateIncomePayment, initialState);
  const [accountId, setAccountId] = useState(payment.money_account_id ?? "");
  const [filesBusy, setFilesBusy] = useState(false);
  const matchingAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === currency
  );
  const streamPeriods = periods.filter(
    (period) => period.stream === (payment.billing_stream ?? "combined")
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="icon-btn !w-8 !h-8"
        aria-label="Edit this payment"
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
                <p className="text-xs muted">
                  Recorded {new Date(payment.created_at).toLocaleDateString()}
                  {payment.updated_at && payment.updated_at !== payment.created_at
                    ? ` · last corrected ${new Date(payment.updated_at).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">
                ✕
              </button>
            </div>

            <TaxBreakdownFields
              currency={currency}
              vatSuggested={
                moneyAccounts.find((account) => account.id === accountId)?.kind === "company_bank"
              }
              record={{
                amount: Number(payment.amount),
                vat: Number(payment.vat_amount ?? 0),
                tds: Number(payment.tds_amount ?? 0),
              }}
            />

            <label className="block">
              <span className="field-label">Date received</span>
              <input
                name="paid_on"
                type="date"
                required
                defaultValue={payment.paid_on}
                className="input mt-1"
              />
            </label>

            {payment.payment_for === "recurring" && streamPeriods.length > 0 && (
              <label className="block">
                <span className="field-label">Which month</span>
                <select
                  name="billing_period_start"
                  defaultValue={payment.billing_period_start ?? ""}
                  className="input mt-1"
                >
                  {streamPeriods.map((period) => (
                    <option key={period.periodStart} value={period.periodStart}>
                      {periodLabel(period)} · {formatIncomeMoney(period.remaining, currency)} left
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className="field-label">Received into</span>
              <select
                name="money_account_id"
                required
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="input mt-1"
              >
                <option value="" disabled>
                  Choose receiving account
                </option>
                {matchingAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.kind === "company_bank"
                      ? "VAT account"
                      : account.kind === "personal_custody"
                        ? "Non-VAT account"
                        : account.name}{" "}
                    · {account.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Method</span>
                <select name="method" defaultValue={payment.method ?? ""} className="input mt-1">
                  <option value="">Not recorded</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Reference</span>
                <input name="reference" defaultValue={payment.reference ?? ""} className="input mt-1" />
              </label>
            </div>

            <label className="block">
              <span className="field-label">Note</span>
              <input name="note" defaultValue={payment.note ?? ""} className="input mt-1" />
            </label>

            <VatBillDocuments existing={vatBills} onBusyChange={setFilesBusy} />

            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending || filesBusy} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : filesBusy ? "Preparing photos…" : "Save payment changes"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
