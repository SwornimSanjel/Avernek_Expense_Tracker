"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  recordIncomePayment,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import {
  PAYMENT_METHOD_LABELS,
  formatIncomeMoney,
  periodLabel,
  todayIso,
  type IncomeAgreementSummary,
} from "@/lib/income";
import type { IncomeAgreement, IncomePaymentFor, MoneyAccount } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Record any client payment — a partial setup instalment, a website payment, or
 * a monthly cycle. Nothing is ever recreated: each payment is its own record
 * and the balances recalculate from the set of them.
 */
export default function RecordIncomePayment({
  agreement,
  summary,
  moneyAccounts,
  compact,
}: {
  agreement: IncomeAgreement;
  summary: IncomeAgreementSummary;
  moneyAccounts: MoneyAccount[];
  compact?: boolean;
}) {
  const streams = summary.recurring.streams.filter((stream) => stream.billingStartDate);
  const targets: { value: IncomePaymentFor; label: string; remaining: number }[] = [
    { value: "setup", label: "Initial / setup billing", remaining: summary.setup.remaining },
    ...(summary.website
      ? [
          {
            value: "website" as const,
            label: "Website project billing",
            remaining: summary.website.remaining,
          },
        ]
      : []),
    ...(streams.length
      ? [{ value: "recurring" as const, label: "Monthly recurring cycle", remaining: summary.recurring.dueNow }]
      : []),
  ];

  const [open, setOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<IncomePaymentFor>(
    targets.find((target) => target.remaining > 0)?.value ?? targets[0]?.value ?? "setup"
  );
  const [streamKey, setStreamKey] = useState(
    summary.recurring.nextDuePeriod?.stream ?? streams[0]?.key ?? "combined"
  );
  const activeStream = streams.find((stream) => stream.key === streamKey) ?? streams[0] ?? null;
  const [periodStart, setPeriodStart] = useState(
    summary.recurring.nextDuePeriod?.periodStart ?? activeStream?.periods[0]?.periodStart ?? ""
  );
  const [state, action, pending] = useActionState(recordIncomePayment, initialState);

  const selectedPeriod = useMemo(
    () => activeStream?.periods.find((period) => period.periodStart === periodStart) ?? null,
    [activeStream, periodStart]
  );
  const matchingAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === agreement.currency
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`btn btn-primary ${compact ? "!h-9 !px-3 text-sm" : ""}`}
      >
        <span className="text-base leading-none">＋</span> Add payment
      </button>
    );
  }

  const suggested =
    paymentFor === "setup"
      ? summary.setup.remaining
      : paymentFor === "website"
        ? summary.website?.remaining ?? 0
        : selectedPeriod?.remaining ?? 0;

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
        <input type="hidden" name="agreement_id" value={agreement.id} />
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Add payment</h2>
            <p className="text-xs muted">{agreement.client_name}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
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
              {targets.map((target) => (
                <option key={target.value} value={target.value}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs muted">
            Amount ({agreement.currency})
            <input
              key={`${paymentFor}-${periodStart}-${streamKey}`}
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={suggested > 0 ? suggested : ""}
              placeholder="Amount received"
              className="input tnum mt-1"
            />
          </label>
        </div>

        {paymentFor === "recurring" && (
          <>
            {summary.recurring.mode === "separate" && streams.length > 1 && (
              <label className="block text-xs muted">
                Which monthly service
                <select
                  name="billing_stream"
                  value={streamKey}
                  onChange={(event) => {
                    const key = event.target.value as typeof streamKey;
                    setStreamKey(key);
                    const stream = streams.find((item) => item.key === key);
                    setPeriodStart(
                      stream?.nextDuePeriod?.periodStart ?? stream?.periods[0]?.periodStart ?? ""
                    );
                  }}
                  className="input mt-1"
                >
                  {streams.map((stream) => (
                    <option key={stream.key} value={stream.key}>
                      {stream.label} · {formatIncomeMoney(stream.monthlyAmount, agreement.currency)} / month
                    </option>
                  ))}
                </select>
              </label>
            )}
            {summary.recurring.mode === "separate" && streams.length <= 1 && (
              <input type="hidden" name="billing_stream" value={streamKey} />
            )}
            <label className="block text-xs muted">
              Billing period covered
              <select
                name="billing_period_start"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                required
                className="input mt-1"
              >
                {(activeStream?.periods ?? []).map((period) => (
                  <option key={period.periodStart} value={period.periodStart}>
                    {periodLabel(period)} ·{" "}
                    {period.remaining > 0
                      ? `${formatIncomeMoney(period.remaining, agreement.currency)} left`
                      : "settled"}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Payment received date
            <input
              name="paid_on"
              type="date"
              required
              defaultValue={todayIso()}
              className="input mt-1"
            />
          </label>
          <label className="block text-xs muted">
            Received into
            <select
              name="money_account_id"
              required
              defaultValue={agreement.default_money_account_id ?? ""}
              className="input mt-1"
            >
              <option value="" disabled>
                Choose account
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
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Method (optional)
            <select name="method" defaultValue="" className="input mt-1">
              <option value="">Not recorded</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs muted">
            Reference (optional)
            <input name="reference" placeholder="Transaction / invoice ID" className="input mt-1" />
          </label>
        </div>

        <label className="block text-xs muted">
          Note (optional)
          <input name="note" placeholder="Advance, second instalment, cash…" className="input mt-1" />
        </label>

        <p className="text-xs muted">
          This is client revenue and raises the selected account balance. Founder money belongs under “Add funds”, not here.
        </p>

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Recording…" : "Record payment"}
        </button>
      </form>
    </div>
  );
}
