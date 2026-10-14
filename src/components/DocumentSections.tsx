"use client";

import { useState } from "react";
import type { Attachment } from "@/lib/attachments";
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
