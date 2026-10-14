"use client";

import { useActionState, useEffect, useState } from "react";
import { uploadAttachments, type AttachmentFormState } from "@/app/(app)/attachments/actions";
import type { AttachmentKind } from "@/lib/attachments";
import AttachmentField from "./AttachmentField";

const initialState: AttachmentFormState = { error: null, ok: null };

/**
 * A small standalone upload box: add files to a record that already exists
 * (e.g. agreement pages for a client added before uploads existed) without
 * opening its full edit form.
 */
export default function AttachmentUpload({
  kind,
  ownerId,
  label,
  hint,
  existingCount,
  buttonLabel = "Save files",
}: {
  kind: AttachmentKind;
  ownerId: string;
  label: string;
  hint?: string;
  existingCount: number;
  buttonLabel?: string;
}) {
  const [state, action, pending] = useActionState(uploadAttachments, initialState);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) setMessage(state.ok);
  }, [state.ok, state.savedAt]);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="owner_id" value={ownerId} />
      <AttachmentField
        name="files"
        label={label}
        hint={hint}
        existingCount={existingCount}
        onBusyChange={setBusy}
        onCountChange={(next) => {
          setCount(next);
          if (next > 0) setMessage(null);
        }}
        resetKey={state.savedAt}
      />
      {count > 0 && (
        <button disabled={pending || busy} className="btn btn-primary !h-10 w-full">
          {pending ? "Saving…" : busy ? "Preparing photos…" : `${buttonLabel} (${count})`}
        </button>
      )}
      {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
      {message && !state.error && <p className="text-xs" style={{ color: "var(--green)" }}>{message}</p>}
    </form>
  );
}
