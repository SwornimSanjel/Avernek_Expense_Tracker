"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  clearLaunchDate,
  markServiceLive,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import {
  addCalendarDays,
  addCalendarMonths,
  formatServiceDate,
  goLiveDate,
  isValidDate,
  todayIso,
} from "@/lib/income";
import type { IncomeAgreement } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Day 1 for the monthly services, set on the day ads / AI automation actually
 * go live — never guessed ahead. Nothing is pre-filled: the person picks
 * “Launched today” or the past date it happened. A Day 1 entered by mistake can
 * be cleared again while no monthly payment depends on it.
 */
export default function MarkServiceLive({
  agreement,
  recurringPaymentCount,
}: {
  agreement: IncomeAgreement;
  recurringPaymentCount: number;
}) {
  const current = goLiveDate(agreement);
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markServiceLive, initialState);
  const [liveDate, setLiveDate] = useState(current ?? "");
  const [clearing, startClear] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);
  const moving = Boolean(current) && current !== liveDate;
  const inFuture = isValidDate(liveDate) && liveDate > today;

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  useEffect(() => {
    if (open) {
      setLiveDate(current ?? "");
      setClearError(null);
    }
  }, [open, current]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary !h-9 text-sm">
        {current ? "Change Day 1" : "Ads launched? Set Day 1"}
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
        <input type="hidden" name="agreement_id" value={agreement.id} />
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Day 1 · launch date</h2>
            <p className="text-xs muted">{agreement.client_name}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        <p className="text-xs muted">
          Only set this once the ads / AI automation are actually live. Until then, leave it — the client
          simply shows “Not launched yet”.
        </p>

        <div className="choice-grid">
          <button
            type="button"
            onClick={() => setLiveDate(today)}
            className={`funding-choice ${liveDate === today ? "funding-choice-active" : ""}`}
          >
            <strong>Launched today</strong>
            <span>{formatServiceDate(today)}</span>
          </button>
          <button
            type="button"
            onClick={() => setLiveDate(addCalendarDays(today, -1))}
            className={`funding-choice ${liveDate === addCalendarDays(today, -1) ? "funding-choice-active" : ""}`}
          >
            <strong>Launched yesterday</strong>
            <span>{formatServiceDate(addCalendarDays(today, -1))}</span>
          </button>
        </div>

        <label className="block">
          <span className="field-label">Or pick the day it went live</span>
          <input
            name="live_date"
            type="date"
            required
            max={today}
            value={liveDate}
            onChange={(event) => setLiveDate(event.target.value)}
            className="input mt-1"
          />
        </label>

        {inFuture && (
          <p className="text-xs" style={{ color: "var(--amber)" }}>
            That date is in the future. Come back and set Day 1 on the day the ads actually go live.
          </p>
        )}

        {isValidDate(liveDate) && !inFuture && (
          <ol className="timeline-preview">
            <li>
              <strong>Month 1 · setup charge</strong>
              <span>from {formatServiceDate(liveDate)}</span>
            </li>
            <li>
              <strong>First monthly fee</strong>
              <span>due {formatServiceDate(addCalendarMonths(liveDate, 1))}</span>
            </li>
          </ol>
        )}

        {moving && recurringPaymentCount > 0 && (
          <label className="checkbox-row" style={{ borderColor: "var(--amber)" }}>
            <input type="checkbox" name="confirm_billing_change" />
            <span>
              <strong>I understand the monthly due dates will move</strong>
              <small>
                {recurringPaymentCount} monthly payment{recurringPaymentCount === 1 ? " is" : "s are"} recorded
                against Day 1 = {formatServiceDate(current)}.
              </small>
            </span>
          </label>
        )}

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        {clearError && <p className="text-sm" style={{ color: "var(--red)" }}>{clearError}</p>}
        <button disabled={pending || !isValidDate(liveDate) || inFuture} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Save Day 1"}
        </button>

        {current && recurringPaymentCount === 0 && (
          <button
            type="button"
            disabled={clearing}
            onClick={() =>
              startClear(async () => {
                try {
                  await clearLaunchDate(agreement.id);
                  setOpen(false);
                } catch (error) {
                  setClearError(error instanceof Error ? error.message : "Could not clear Day 1.");
                }
              })
            }
            className="btn w-full !h-11"
          >
            {clearing ? "Clearing…" : "Not launched yet — remove Day 1"}
          </button>
        )}
      </form>
    </div>
  );
}
