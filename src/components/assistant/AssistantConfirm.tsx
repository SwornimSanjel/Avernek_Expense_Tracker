"use client";

import Icon from "@/components/Icons";
import type { ConfirmRequest } from "@/lib/ai/types";

/**
 * A prepared change, shown in full before anything is saved. Confirm runs it
 * once (the server claims the draft atomically, so a second click or tab
 * cannot repeat it); Edit reopens it as a form; Cancel discards it.
 */
export default function AssistantConfirm({
  confirm,
  disabled,
  onDecide,
}: {
  confirm: ConfirmRequest;
  disabled: boolean;
  onDecide: (decision: "confirm" | "cancel" | "edit") => void;
}) {
  return (
    <section className={`assistant-card ${disabled ? "assistant-resolved" : ""}`} aria-label={confirm.title}>
      <div className="assistant-card-title">{confirm.title}</div>
      <dl className="assistant-facts">
        {confirm.rows.map((row, index) => (
          <div key={index} style={{ display: "contents" }}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {confirm.warnings?.length ? (
        <div className="alert alert-warn assistant-warnings">
          {confirm.warnings.map((warning, index) => (
            <span key={index}>{warning}</span>
          ))}
        </div>
      ) : null}
      <div className="assistant-confirm-actions">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onDecide("confirm")}>
          <Icon name="check" size={18} strokeWidth={2.2} /> {confirm.confirmLabel}
        </button>
        <div className="assistant-actions">
          <button type="button" className="btn" disabled={disabled} onClick={() => onDecide("edit")}>
            Change something
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => onDecide("cancel")}>
            Cancel
          </button>
        </div>
      </div>
      <div className="assistant-note">Nothing is saved until you press {confirm.confirmLabel}.</div>
    </section>
  );
}
