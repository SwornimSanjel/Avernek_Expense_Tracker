"use client";

import { useCallback, useRef, useState } from "react";
import type { Attachment } from "@/lib/attachments";
import type { VatBillPaymentRow } from "@/lib/income";
import FileUploader from "./FileUploader";
import Icon from "./Icons";

/**
 * The two document sections a client can have. They are deliberately
 * different: the signed agreement is a multi-page document that belongs to
 * the client, while a VAT bill belongs to one payment and only exists when a
 * VAT bill was actually cut. Neither is required.
 */

/** Signed agreement pages — big numbered page tiles. Optional. */
export function AgreementDocuments({
  name = "agreement_files",
  existing = [],
  onBusyChange,
  resetKey,
  onCountChange,
  readOnly,
  footer,
}: {
  name?: string;
  existing?: Attachment[];
  onBusyChange?: (busy: boolean) => void;
  resetKey?: unknown;
  onCountChange?: (count: number) => void;
  readOnly?: boolean;
  /** Rendered under the tiles, e.g. a Save button for a standalone form. */
  footer?: React.ReactNode;
}) {
  return (
    <section className="doc-section doc-section-agreement">
      <header className="doc-section-head">
        <span className="doc-section-icon">
          <Icon name="contribution" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3>Signed agreement</h3>
          <p>
            Photo of every signed page, or one PDF. Optional — add it whenever you have it.
          </p>
        </div>
        <span className={`status-pill ${existing.length ? "status-pill-ok" : "status-pill-muted"}`}>
          {existing.length ? `${existing.length} page${existing.length === 1 ? "" : "s"} on file` : "Not uploaded"}
        </span>
      </header>
      <FileUploader
        name={name}
        variant="pages"
        existing={existing}
        lastFileWarning="This is the only page on file."
        onBusyChange={onBusyChange}
        onCountChange={onCountChange}
        resetKey={resetKey}
        readOnly={readOnly}
      />
      {footer}
    </section>
  );
}

/**
 * VAT bill for one payment. Asks first whether a VAT bill was cut; the
 * uploader only appears for "Yes". Payments without a VAT bill skip it.
 */
export function VatBillDocuments({
  name = "vat_bill_files",
  existing = [],
  onBusyChange,
}: {
  name?: string;
  existing?: Attachment[];
  onBusyChange?: (busy: boolean) => void;
}) {
  const [cut, setCut] = useState(existing.length > 0);

  return (
    <section className="doc-section doc-section-vat">
      <header className="doc-section-head">
        <span className="doc-section-icon">
          <Icon name="receipt" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3>VAT bill</h3>
          <p>Did you cut a VAT bill for this payment?</p>
        </div>
        {existing.length > 0 ? (
          <span className="status-pill status-pill-ok">
            {existing.length} file{existing.length === 1 ? "" : "s"} saved
          </span>
        ) : (
          <div className="segmented doc-section-toggle" role="radiogroup" aria-label="VAT bill cut?">
            <button
              type="button"
              role="radio"
              aria-checked={!cut}
              onClick={() => setCut(false)}
              className={!cut ? "segmented-on" : ""}
            >
              No
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={cut}
              onClick={() => setCut(true)}
              className={cut ? "segmented-on" : ""}
            >
              Yes, attach it
            </button>
          </div>
        )}
      </header>
      {cut && (
        <FileUploader
          name={name}
          variant="bill"
          existing={existing}
          addLabel="Add VAT bill"
          onBusyChange={onBusyChange}
        />
      )}
    </section>
  );
}

/** Bill / receipt for an expense or a company bill. Optional, compact. */
export function BillDocuments({
  name,
  existing = [],
  title = "Bill / receipt",
  onBusyChange,
}: {
  name: string;
  existing?: Attachment[];
  title?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  return (
    <section className="doc-section doc-section-bill">
      <header className="doc-section-head">
        <span className="doc-section-icon">
          <Icon name="receipt" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3>{title}</h3>
          <p>Optional · photo or PDF · add it later from Edit if you don&apos;t have it yet.</p>
        </div>
        {existing.length > 0 && (
          <span className="status-pill status-pill-ok">
            {existing.length} saved
          </span>
        )}
      </header>
      <FileUploader name={name} variant="bill" existing={existing} addLabel="Add bill" onBusyChange={onBusyChange} />
    </section>
  );
}

/**
 * Several uploaders feeding one "busy" flag: the form stays locked while any
 * of them is still preparing photos.
 */
export function useBusyTracker(onBusyChange?: (busy: boolean) => void) {
  const busy = useRef(new Set<string>());
  return useCallback(
    (key: string) => (isBusy: boolean) => {
      if (isBusy) busy.current.add(key);
      else busy.current.delete(key);
      onBusyChange?.(busy.current.size > 0);
    },
    [onBusyChange]
  );
}

/**
 * VAT bills for a whole client: one row per payment that carried VAT, each
 * with its own tiles. A VAT bill always belongs to a payment, so payments
 * without VAT are not listed.
 */
export function ClientVatBills({
  payments,
  billsByPayment,
  onBusyChange,
  readOnly,
  emptyText = "No payment with VAT yet. When you record one, its VAT bill can be attached here or in the payment itself.",
  resetKey,
  onCountChange,
  footer,
}: {
  payments: VatBillPaymentRow[];
  billsByPayment: Record<string, Attachment[]>;
  onBusyChange?: (busy: boolean) => void;
  readOnly?: boolean;
  emptyText?: string;
  resetKey?: unknown;
  onCountChange?: (count: number) => void;
  footer?: React.ReactNode;
}) {
  const track = useBusyTracker(onBusyChange);
  const counts = useRef(new Map<string, number>());
  const saved = payments.reduce((sum, row) => sum + (billsByPayment[row.id]?.length ?? 0), 0);

  return (
    <section className="doc-section doc-section-vat">
      <header className="doc-section-head">
        <span className="doc-section-icon">
          <Icon name="receipt" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3>VAT bills</h3>
          <p>Only for payments where you cut a VAT bill. Optional — skip any you don&apos;t have.</p>
        </div>
        <span className={`status-pill ${saved ? "status-pill-ok" : "status-pill-muted"}`}>
          {saved ? `${saved} file${saved === 1 ? "" : "s"} on file` : "None yet"}
        </span>
      </header>

      {payments.length === 0 ? (
        <p className="doc-empty">{emptyText}</p>
      ) : (
        <ul className="vat-bill-rows">
          {payments.map((row) => {
            const existing = billsByPayment[row.id] ?? [];
            return (
              <li key={row.id}>
                <div className="vat-bill-row-info">
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                  <em className={existing.length ? "is-done" : ""}>
                    {existing.length ? `${existing.length} VAT bill file${existing.length === 1 ? "" : "s"}` : "No VAT bill attached"}
                  </em>
                </div>
                <FileUploader
                  name={`vat_bill_files:${row.id}`}
                  variant="bill"
                  existing={existing}
                  readOnly={readOnly}
                  addLabel="Add VAT bill"
                  onBusyChange={track(row.id)}
                  resetKey={resetKey}
                  onCountChange={(count) => {
                    counts.current.set(row.id, count);
                    onCountChange?.([...counts.current.values()].reduce((sum, value) => sum + value, 0));
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </section>
  );
}
