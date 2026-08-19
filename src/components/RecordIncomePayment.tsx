"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  recordIncomePayment,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import { formatIncomeMoney, periodLabel, type RecurringPeriod } from "@/lib/income";
import type { IncomeAgreement, IncomePaymentFor, MoneyAccount } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

function today() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export default function RecordIncomePayment({
  agreement,
  setupRemaining,
  periods,
  suggestedPeriod,
  moneyAccounts,
}: {
  agreement: IncomeAgreement;
  setupRemaining: number;
  periods: RecurringPeriod[];
  suggestedPeriod: string | null;
  moneyAccounts: MoneyAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<IncomePaymentFor>(
    setupRemaining > 0 ? "setup" : "recurring"
  );
  const [periodStart, setPeriodStart] = useState(
    suggestedPeriod ?? periods[0]?.periodStart ?? ""
  );
  const [state, action, pending] = useActionState(recordIncomePayment, initialState);
  const selectedPeriod = useMemo(
    () => periods.find((period) => period.periodStart === periodStart),
    [periodStart, periods]
  );
  const matchingAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === agreement.currency
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary !h-9 !px-3 text-sm">
        <span className="text-base leading-none">＋</span> Record payment
      </button>
    );
  }

  const suggestedAmount =
    paymentFor === "setup" ? setupRemaining : (selectedPeriod?.remaining ?? 0);

  return (
    <div className="modal-backdrop">
      <form
        action={action}
        className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4"
      >
        <input type="hidden" name="agreement_id" value={agreement.id} />
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Record client payment</h2>
            <p className="text-xs muted">{agreement.client_name}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Payment for
            <select
              name="payment_for"
              value={paymentFor}
              onChange={(event) => setPaymentFor(event.target.value as IncomePaymentFor)}
              className="input mt-1"
            >
              <option value="setup">Setup fee</option>
              <option value="recurring">Recurring cycle</option>
            </select>
          </label>
          <label className="block text-xs muted">
            Amount ({agreement.currency})
            <input
              key={`${paymentFor}-${periodStart}`}
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={suggestedAmount > 0 ? suggestedAmount : ""}
              placeholder="Amount received"
              className="input tnum mt-1"
            />
          </label>
        </div>

        {paymentFor === "recurring" && (
          <label className="block text-xs muted">
            30-day cycle covered
            <select
              name="billing_period_start"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
              className="input mt-1"
            >
              {periods.map((period) => (
                <option key={period.periodStart} value={period.periodStart}>
                  {periodLabel(period)} · {formatIncomeMoney(period.remaining, agreement.currency)} left
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Paid on
            <input
              name="paid_on"
              type="date"
              required
              defaultValue={today()}
              className="input mt-1"
            />
          </label>
          <label className="block text-xs muted">
            Client paid into
            <select name="money_account_id" required defaultValue="" className="input mt-1">
              <option value="" disabled>Choose account</option>
              {matchingAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-xs muted">The receipt increases the selected company-money balance. Swornim Global IME is still company money, not Swornim&apos;s investment.</p>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Reference (optional)
            <input name="reference" placeholder="Transaction / invoice ID" className="input mt-1" />
          </label>
          <label className="block text-xs muted">
            Note (optional)
            <input name="note" placeholder="Half advance, cash, etc." className="input mt-1" />
          </label>
        </div>

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Recording…" : "Record payment"}
        </button>
      </form>
    </div>
  );
}
