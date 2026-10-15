"use client";

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
        <div className="alert alert-warn mt-3" style={{ flexDirection: "column", gap: 4 }}>
          {confirm.warnings.map((warning, index) => (
            <span key={index}>{warning}</span>
          ))}
        </div>
      ) : null}
      <div className="assistant-actions mt-3">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onDecide("confirm")}>
          {confirm.confirmLabel}
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={() => onDecide("edit")}>
          Edit
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={() => onDecide("cancel")}>
          Cancel
        </button>
      </div>
      <div className="assistant-note">Nothing is saved until you press {confirm.confirmLabel}.</div>
    </section>
  );
}
