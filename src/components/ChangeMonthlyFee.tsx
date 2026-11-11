"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/Icons";
import { guardRequest } from "@/lib/stale-deploy";
import {
  changeMonthlyFee,
  removeMonthlyFeeChange,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import {
  formatIncomeMoney,
  formatServiceDate,
  periodLabel,
  type RecurringStreamSummary,
} from "@/lib/income";
import type { BillingStream } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

type StreamInfo = Pick<RecurringStreamSummary, "key" | "label" | "periods" | "monthlyAmount">;

/**
 * Lower or raise a client's monthly fee from a chosen month onwards — for a
 * client who cut back their service, or a renegotiated price. Months before
 * that keep their old price, so past balances and payments never move.
 *
 * Renders its own "Change fee" button, or pass `open` + `onClose` to drive it
 * from somewhere else (the Add payment window, which is itself a form).
 */
export default function ChangeMonthlyFee({
  agreementId,
  clientName,
  currency,
  stream,
  setupCoversFirstCycle,
  defaultFrom,
  open: controlledOpen,
  onClose,
  buttonClassName = "btn btn-sm",
}: {
  agreementId: string;
  clientName: string;
  currency: string;
  stream: StreamInfo;
  setupCoversFirstCycle: boolean;
  /** Month preselected as the start of the new fee. */
  defaultFrom?: string;
  open?: boolean;
  onClose?: () => void;
  buttonClassName?: string;
}) {
  const controlled = controlledOpen !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? controlledOpen : selfOpen;
  const close = () => (controlled ? onClose?.() : setSelfOpen(false));

  return (
    <>
      {!controlled && (
        <button type="button" onClick={() => setSelfOpen(true)} className={buttonClassName}>
          <Icon name="edit" size={14} /> Change fee
        </button>
      )}
      {open &&
        // Portalled so it stacks above the Add payment window and never sits
        // inside that window's <form>.
        createPortal(
          <FeeDialog
            agreementId={agreementId}
            clientName={clientName}
            currency={currency}
            stream={stream}
            setupCoversFirstCycle={setupCoversFirstCycle}
            defaultFrom={defaultFrom}
            onClose={close}
          />,
          document.body
        )}
    </>
  );
}

function FeeDialog({
  agreementId,
  clientName,
  currency,
  stream,
  setupCoversFirstCycle,
  defaultFrom,
  onClose,
}: {
  agreementId: string;
  clientName: string;
  currency: string;
  stream: StreamInfo;
  setupCoversFirstCycle: boolean;
  defaultFrom?: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(guardRequest(changeMonthlyFee), initialState);
  const firstUnpaid = stream.periods.find((period) => period.remaining > 0)?.periodStart;
  const [from, setFrom] = useState(
    (defaultFrom && stream.periods.some((period) => period.periodStart === defaultFrom) ? defaultFrom : null) ??
      firstUnpaid ??
      stream.periods.at(-1)?.periodStart ??
      ""
  );
  const [amount, setAmount] = useState("");
  const selected = stream.periods.find((period) => period.periodStart === from) ?? null;
  const oldFee = selected?.agreed ?? stream.monthlyAmount;
  const newFee = amount === "" ? null : Number(amount);
  const firstMonthNumber = setupCoversFirstCycle ? 2 : 1;

  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
        <input type="hidden" name="agreement_id" value={agreementId} />
        <input type="hidden" name="billing_stream" value={stream.key} />
        <input type="hidden" name="from" value={from} />
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">Change monthly fee</h2>
            <p className="text-[13px] muted">
              {clientName}
              {stream.key !== "combined" ? ` · ${stream.label}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <label className="block">
          <span className="field-label">New monthly fee</span>
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={String(oldFee)}
            className="input tnum mt-1 !h-12 !text-lg"
          />
          <p className="field-help">Excluding VAT. Now {formatIncomeMoney(oldFee, currency)} a month.</p>
        </label>

        <label className="block">
          <span className="field-label">Starts from</span>
          <select
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
            className="input mt-1"
          >
            {stream.periods.map((period, index) => (
              <option key={period.periodStart} value={period.periodStart}>
                Month {index + firstMonthNumber} · {periodLabel(period)} ·{" "}
                {formatIncomeMoney(period.agreed, currency)}
                {period.paid > 0 ? (period.remaining > 0 ? " · part paid" : " · paid") : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label">Reason (optional)</span>
          <input
            name="note"
            maxLength={200}
            placeholder="Reduced service"
            className="input mt-1"
          />
        </label>

        {newFee != null && Number.isFinite(newFee) && selected && (
          <div className="fee-preview">
            <span className="tnum">{formatIncomeMoney(oldFee, currency)}</span>
            <Icon name="arrow" size={14} />
            <strong className="tnum">{formatIncomeMoney(newFee, currency)}</strong>
            <span className="muted">from {formatServiceDate(selected.periodStart)}</span>
          </div>
        )}
        <p className="text-[13px] muted">Earlier months keep their old fee.</p>

        {state.error && (
          <p className="text-sm" style={{ color: "var(--red)" }}>
            {state.error}
          </p>
        )}
        <button disabled={pending || !from || amount === ""} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Save new fee"}
        </button>
      </form>
    </div>
  );
}

/** Undo one fee change from the client page's fee history. */
export function UndoFeeChange({
  agreementId,
  stream,
  from,
  label,
}: {
  agreementId: string;
  stream: BillingStream;
  from: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Undo the fee change from ${label}? Those months go back to the earlier fee.`)) return;
        startTransition(async () => {
          const result = await removeMonthlyFeeChange(agreementId, stream, from);
          if (result.error) window.alert(result.error);
        });
      }}
      className="icon-btn !w-8 !h-8"
      aria-label={`Undo the fee change from ${label}`}
      title="Undo this fee change"
    >
      {pending ? "…" : <Icon name="trash" size={14} />}
    </button>
  );
}
