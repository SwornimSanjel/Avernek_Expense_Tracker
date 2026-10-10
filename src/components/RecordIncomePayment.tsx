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
import { accountShortName } from "@/lib/funds";
import type { IncomeAgreement, IncomePaymentFor, MoneyAccount } from "@/lib/types";
import TaxBreakdownFields from "./TaxBreakdownFields";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Record money from a client the way it happened: which account it landed in,
 * what it paid for, and how it splits into bill amount, VAT and TDS. Each
 * payment is its own record; balances recalculate from the set of them.
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
  const hasMonthly = agreement.has_ads || agreement.has_automation;
  const targets: { value: IncomePaymentFor; label: string; sub: string; remaining: number }[] = [
    ...(hasMonthly || summary.setup.agreed > 0
      ? [{
          value: "setup" as const,
          label: "Setup · month 1",
          sub: `${formatIncomeMoney(summary.setup.remaining, agreement.currency)} left`,
          remaining: summary.setup.remaining,
        }]
      : []),
    ...(streams.length
      ? [{
          value: "recurring" as const,
          label: "Monthly fee",
          sub: summary.recurring.dueNow > 0
            ? `${formatIncomeMoney(summary.recurring.dueNow, agreement.currency)} due now`
            : "Pay a month",
          remaining: summary.recurring.dueNow,
        }]
      : []),
    ...(summary.website
      ? [{
          value: "website" as const,
          label: "Website",
          sub: `${formatIncomeMoney(summary.website.remaining, agreement.currency)} left`,
          remaining: summary.website.remaining,
        }]
      : []),
  ];

  const matchingAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === agreement.currency
  );
  const [open, setOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<IncomePaymentFor>(
    targets.find((target) => target.remaining > 0)?.value ?? targets[0]?.value ?? "setup"
  );
  const [accountId, setAccountId] = useState(
    agreement.default_money_account_id ?? matchingAccounts[0]?.id ?? ""
  );
  const streamKey = summary.recurring.nextDuePeriod?.stream ?? streams[0]?.key ?? "combined";
  const activeStream = streams.find((stream) => stream.key === streamKey) ?? streams[0] ?? null;
  const [periodStart, setPeriodStart] = useState(
    summary.recurring.nextDuePeriod?.periodStart ?? activeStream?.periods[0]?.periodStart ?? ""
  );
  const [state, action, pending] = useActionState(recordIncomePayment, initialState);

  const selectedPeriod = useMemo(
    () => activeStream?.periods.find((period) => period.periodStart === periodStart) ?? null,
    [activeStream, periodStart]
  );
  const account = matchingAccounts.find((item) => item.id === accountId);

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

  const remaining =
    paymentFor === "setup"
      ? summary.setup.remaining
      : paymentFor === "website"
        ? summary.website?.remaining ?? 0
        : selectedPeriod?.remaining ?? 0;

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-xl p-5 md:p-6 space-y-4">
        <input type="hidden" name="agreement_id" value={agreement.id} />
        <input type="hidden" name="payment_for" value={paymentFor} />
        {paymentFor === "recurring" && activeStream && (
          <input type="hidden" name="billing_stream" value={activeStream.key} />
        )}
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Add payment</h2>
            <p className="text-xs muted">{agreement.client_name}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        <div>
          <span className="field-label">1 · What is this payment for?</span>
          <div className="choice-grid mt-2">
            {targets.map((target) => (
              <button
                key={target.value}
                type="button"
                onClick={() => setPaymentFor(target.value)}
                className={`funding-choice ${paymentFor === target.value ? "funding-choice-active" : ""}`}
              >
                <strong>{target.label}</strong>
                <span>{target.sub}</span>
              </button>
            ))}
          </div>
          {!streams.length && hasMonthly && (
            <p className="field-help">
              Monthly payments open once Day 1 (launch date) is set on this client.
            </p>
          )}
        </div>

        {paymentFor === "recurring" && (
          <label className="block">
            <span className="field-label">Which month</span>
            <select
              name="billing_period_start"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
              className="input mt-1"
            >
              {(activeStream?.periods ?? []).map((period, index) => (
                <option key={period.periodStart} value={period.periodStart}>
                  Month {index + (agreement.setup_covers_first_cycle ? 2 : 1)} · {periodLabel(period)} ·{" "}
                  {period.remaining > 0
                    ? `${formatIncomeMoney(period.remaining, agreement.currency)} left`
                    : "paid"}
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <span className="field-label">2 · Which account did it land in?</span>
          <div className="choice-grid mt-2">
            {matchingAccounts.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAccountId(item.id)}
                className={`funding-choice ${accountId === item.id ? "funding-choice-active" : ""}`}
              >
                <strong>{accountShortName(item)}</strong>
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          <input type="hidden" name="money_account_id" value={accountId} />
        </div>

        <div>
          <span className="field-label">3 · How much?</span>
          <div className="mt-2">
            <TaxBreakdownFields
              key={`${paymentFor}-${periodStart}`}
              currency={agreement.currency}
              vatSuggested={account?.kind === "company_bank"}
              suggestedAmount={remaining > 0 ? remaining : undefined}
              remainingHint={`${formatIncomeMoney(remaining, agreement.currency)} still owed on this (excluding VAT). Paying less is fine — it stays partly paid.`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="field-label">Date received</span>
            <input name="paid_on" type="date" required defaultValue={todayIso()} className="input mt-1" />
          </label>
          <label className="block">
            <span className="field-label">Method (optional)</span>
            <select name="method" defaultValue="bank_transfer" className="input mt-1">
              <option value="">Not recorded</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Reference / VAT bill no. (optional)</span>
            <input name="reference" placeholder="Transaction or bill no." className="input mt-1" />
          </label>
          <label className="block">
            <span className="field-label">Note (optional)</span>
            <input name="note" placeholder="Advance, second instalment…" className="input mt-1" />
          </label>
        </div>

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending || !accountId} className="btn btn-primary w-full !h-12">
          {pending ? "Recording…" : "Record payment"}
        </button>
      </form>
    </div>
  );
}
