"use client";

import { guardRequest } from "@/lib/stale-deploy";
import { useActionState, useEffect, useState } from "react";
import { uploadAttachments, type AttachmentFormState } from "@/app/(app)/attachments/actions";
import type { Attachment } from "@/lib/attachments";
import { AgreementDocuments } from "./DocumentSections";

const initialState: AttachmentFormState = { error: null, ok: null };

/**
 * The signed agreement on the client page: see every page, add more, delete
 * one — without opening the full edit form. New pages are saved with the
 * button that appears once something is picked.
 */
export default function AgreementUploadPanel({
  agreementId,
  files,
  canManage,
}: {
  agreementId: string;
  files: Attachment[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(guardRequest(uploadAttachments), initialState);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) setSaved(state.ok);
  }, [state.ok, state.savedAt]);

  return (
    <form action={action}>
      <input type="hidden" name="kind" value="client_agreement" />
      <input type="hidden" name="owner_id" value={agreementId} />
      <AgreementDocuments
        name="files"
        existing={files}
        readOnly={!canManage}
        onBusyChange={setBusy}
        onCountChange={(next) => {
          setCount(next);
          if (next > 0) setSaved(null);
        }}
        resetKey={state.savedAt}
        footer={
          <>
            {count > 0 && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button disabled={pending || busy} className="btn btn-primary !h-10 !px-5">
                  {pending ? "Saving…" : busy ? "Preparing photos…" : `Save ${count} page${count === 1 ? "" : "s"}`}
                </button>
                <span className="text-xs muted">Not saved until you press Save.</span>
              </div>
            )}
            {state.error && <p className="text-sm mt-2" style={{ color: "var(--red)" }}>{state.error}</p>}
            {saved && !state.error && count === 0 && (
              <p className="text-xs mt-2" style={{ color: "var(--green)" }}>{saved}</p>
            )}
          </>
        }
      />
    </form>
  );
}
