"use client";

import { useActionState, useEffect, useState } from "react";
import { markServiceLive, type IncomeFormState } from "@/app/(app)/income/actions";
import { formatServiceDate, isValidDate, todayIso } from "@/lib/income";
import type { IncomeAgreement } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * "Mark ads live" / "Mark automation live".
 *
 * The live date is the real-world day the service started running. When no
 * recurring anchor exists yet, the live date is offered as that anchor with the
 * answer pre-set to yes — but it is a question, not a silent write, and an
 * existing anchor is never moved without an explicit confirmation when cycle
 * payments already depend on it.
 */
export default function MarkServiceLive({
  agreement,
  service,
  recurringPaymentCount,
}: {
  agreement: IncomeAgreement;
  service: "ads" | "automation";
  recurringPaymentCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markServiceLive, initialState);
  const [liveDate, setLiveDate] = useState(
    (service === "ads" ? agreement.ads_live_date : agreement.automation_live_date) ?? todayIso()
  );
  const separate = agreement.recurring_billing_mode === "separate";
  const existingAnchor = separate
    ? service === "ads"
      ? agreement.ads_billing_start_date
      : agreement.automation_billing_start_date
    : agreement.recurring_billing_start_date;
  const anchorExists = isValidDate(existingAnchor);
  // Offered by default only when nothing is anchored yet. An existing anchor is
  // never moved unless the admin deliberately asks for it.
  const [useAsStart, setUseAsStart] = useState(!anchorExists);
  const willMoveAnchor = useAsStart && anchorExists && existingAnchor !== liveDate;

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  // Re-answer the anchor question every time the dialog opens. Without this the
  // component keeps the answer it was first mounted with, so marking the second
  // service live would arrive pre-set to move an anchor that now exists.
  useEffect(() => {
    if (open) setUseAsStart(!anchorExists);
  }, [open, anchorExists]);

  const label = service === "ads" ? "ads" : "AI automation";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn !h-9 text-sm">
        Mark {label} live
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
        <input type="hidden" name="agreement_id" value={agreement.id} />
        <input type="hidden" name="service" value={service} />
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Mark {label} live</h2>
            <p className="text-xs muted">{agreement.client_name}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        <label className="block">
          <span className="field-label">{service === "ads" ? "Ads live date" : "Automation live date"}</span>
          <input
            name="live_date"
            type="date"
            required
            value={liveDate}
            onChange={(event) => setLiveDate(event.target.value)}
            className="input mt-1"
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            name="use_as_billing_start"
            checked={useAsStart}
            onChange={(event) => setUseAsStart(event.target.checked)}
          />
          <span>
            <strong>
              Use {formatServiceDate(liveDate)} as the recurring billing start date?
            </strong>
            <small>
              {anchorExists
                ? `Recurring billing currently starts ${formatServiceDate(existingAnchor)}.`
                : "Monthly cycles will count from this date."}
            </small>
          </span>
        </label>

        {willMoveAnchor && recurringPaymentCount > 0 && (
          <label className="checkbox-row" style={{ borderColor: "var(--amber)" }}>
            <input type="checkbox" name="confirm_billing_change" />
            <span>
              <strong>I understand this recalculates billing</strong>
              <small>
                {recurringPaymentCount} recurring payment
                {recurringPaymentCount === 1 ? " is" : "s are"} recorded against the current
                billing start date. Moving it changes every future due date.
              </small>
            </span>
          </label>
        )}

        {willMoveAnchor && recurringPaymentCount === 0 && (
          <p className="text-xs" style={{ color: "var(--amber)" }}>
            This replaces the current billing start date of {formatServiceDate(existingAnchor)}.
          </p>
        )}

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : `Mark ${label} live`}
        </button>
      </form>
    </div>
  );
}
