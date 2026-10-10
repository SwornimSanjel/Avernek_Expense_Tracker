"use client";

import { useActionState, useEffect, useState } from "react";
import { markServiceLive, type IncomeFormState } from "@/app/(app)/income/actions";
import {
  addCalendarMonths,
  formatServiceDate,
  goLiveDate,
  isValidDate,
  todayIso,
} from "@/lib/income";
import type { IncomeAgreement } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * "Launched · Day 1" for the monthly services. One date: month 1 is covered by
 * the setup charge, the monthly fee is due one calendar month later and every
 * month after that.
 */
export default function MarkServiceLive({
  agreement,
  recurringPaymentCount,
}: {
  agreement: IncomeAgreement;
  recurringPaymentCount: number;
}) {
  const current = goLiveDate(agreement);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markServiceLive, initialState);
  const [liveDate, setLiveDate] = useState(current ?? todayIso());
  const moving = Boolean(current) && current !== liveDate;

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary !h-9 text-sm">
        {current ? "Change Day 1" : "Launched · set Day 1"}
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

        <label className="block">
          <span className="field-label">Ads / AI automation went live on</span>
          <input
            name="live_date"
            type="date"
            required
            value={liveDate}
            onChange={(event) => setLiveDate(event.target.value)}
            className="input mt-1"
          />
        </label>

        {isValidDate(liveDate) && (
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
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Save Day 1"}
        </button>
      </form>
    </div>
  );
}
