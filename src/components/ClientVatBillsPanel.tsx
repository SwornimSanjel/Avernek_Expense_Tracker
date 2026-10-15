"use client";

import { guardRequest } from "@/lib/stale-deploy";
import { useActionState, useEffect, useState } from "react";
import { uploadClientVatBills, type AttachmentFormState } from "@/app/(app)/attachments/actions";
import type { Attachment } from "@/lib/attachments";
import type { VatBillPaymentRow } from "@/lib/income";
import { ClientVatBills } from "./DocumentSections";

const initialState: AttachmentFormState = { error: null, ok: null };

/**
 * VAT bills on the client page: every payment that carried VAT, each with its
 * own tiles. New files are saved with the button that appears once any are
 * picked.
 */
export default function ClientVatBillsPanel({
  agreementId,
  payments,
  billsByPayment,
  canManage,
}: {
  agreementId: string;
  payments: VatBillPaymentRow[];
  billsByPayment: Record<string, Attachment[]>;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(guardRequest(uploadClientVatBills), initialState);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) setSaved(state.ok);
  }, [state.ok, state.savedAt]);

  return (
    <form action={action}>
      <input type="hidden" name="agreement_id" value={agreementId} />
      <ClientVatBills
        payments={payments}
        billsByPayment={billsByPayment}
        readOnly={!canManage}
        onBusyChange={setBusy}
        resetKey={state.savedAt}
        onCountChange={(next) => {
          setCount(next);
          if (next > 0) setSaved(null);
        }}
        footer={
          <>
            {count > 0 && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button disabled={pending || busy} className="btn btn-primary !h-10 !px-5">
                  {pending ? "Saving…" : busy ? "Preparing photos…" : `Save ${count} VAT bill file${count === 1 ? "" : "s"}`}
                </button>
                <span className="text-[13px] muted">Not saved until you press Save.</span>
              </div>
            )}
            {state.error && <p className="text-sm mt-2" style={{ color: "var(--red)" }}>{state.error}</p>}
            {saved && !state.error && count === 0 && (
              <p className="text-[13px] mt-2" style={{ color: "var(--green)" }}>{saved}</p>
            )}
          </>
        }
      />
    </form>
  );
}
