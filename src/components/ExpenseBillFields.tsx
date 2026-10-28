"use client";

import { useState } from "react";
import type { Attachment } from "@/lib/attachments";
import FileUploader from "./FileUploader";
import Icon from "./Icons";

export type BillAnswer = "yes" | "no" | "";

/** "123 456 789" → "123456789". PAN / VAT numbers in Nepal are 9 digits. */
export function cleanPan(value: string): string {
  return value.replace(/\D/g, "").slice(0, 9);
}

/**
 * "Do you have a bill?" on every expense. No → nothing more to fill in.
 * Yes → the bill number, the seller's PAN / VAT number and a photo of the bill.
 *
 * Posts `has_bill` ("yes" / "no" / "" when unanswered), `bill_number`,
 * `seller_pan` and the photo ids under `bills`. The server checks it all again.
 */
export default function ExpenseBillFields({
  initial = "",
  initialNumber = "",
  initialPan = "",
  existing = [],
  error,
  onAnswer,
  onPhotoCount,
  onBusyChange,
}: {
  initial?: BillAnswer;
  initialNumber?: string;
  initialPan?: string;
  /** Bill photos already saved on the expense. */
  existing?: Attachment[];
  /** Shown under the question, e.g. "Choose Yes or No". */
  error?: string | null;
  onAnswer?: (answer: BillAnswer) => void;
  /** Photos uploaded in this form (not counting `existing`). */
  onPhotoCount?: (count: number) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [answer, setAnswer] = useState<BillAnswer>(initial);
  // Controlled, so a failed save (React resets the form) keeps what was typed.
  const [number, setNumber] = useState(initialNumber);
  const [pan, setPan] = useState(cleanPan(initialPan));

  function choose(next: BillAnswer) {
    setAnswer(next);
    onAnswer?.(next);
  }

  return (
    <section className={`doc-section doc-section-bill ${error ? "doc-section-error" : ""}`} id="expense-bill">
      <input type="hidden" name="has_bill" value={answer} />
      <header className="doc-section-head">
        <span className="doc-section-icon">
          <Icon name="receipt" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3>Do you have a bill?</h3>
          <p>{answer === "yes" ? "Bill number, PAN and a photo." : "A VAT or PAN bill from the seller."}</p>
        </div>
        <div className="segmented doc-section-toggle" role="radiogroup" aria-label="Do you have a bill?">
          <button type="button" role="radio" aria-checked={answer === "no"} onClick={() => choose("no")} className={answer === "no" ? "segmented-on" : ""}>
            No bill
          </button>
          <button type="button" role="radio" aria-checked={answer === "yes"} onClick={() => choose("yes")} className={answer === "yes" ? "segmented-on" : ""}>
            Yes, I have one
          </button>
        </div>
      </header>

      {error && (
        <p className="bill-field-error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}

      {answer === "yes" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="field-label">Bill number</span>
              <input
                name="bill_number"
                required
                maxLength={60}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="e.g. 1042"
                className="input mt-1"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="field-label">PAN / VAT number</span>
              <input
                name="seller_pan"
                required
                inputMode="numeric"
                pattern="[0-9]{9}"
                title="9 digits"
                value={pan}
                onChange={(event) => setPan(cleanPan(event.target.value))}
                placeholder="9 digits"
                className="input tnum mt-1"
                autoComplete="off"
              />
            </label>
          </div>
          <div>
            <span className="field-label">Photo of the bill</span>
            <div className="mt-1">
              <FileUploader
                name="bills"
                kind="expense_bill"
                variant="bill"
                existing={existing}
                addLabel="Add bill photo"
                onBusyChange={onBusyChange}
                onCountChange={onPhotoCount}
              />
            </div>
          </div>
        </div>
      )}

      {/* Photos saved before "No bill" was chosen stay visible and removable. */}
      {answer !== "yes" && existing.length > 0 && (
        <FileUploader name="bills" kind="expense_bill" variant="bill" existing={existing} addLabel="Add bill photo" onBusyChange={onBusyChange} />
      )}
    </section>
  );
}
