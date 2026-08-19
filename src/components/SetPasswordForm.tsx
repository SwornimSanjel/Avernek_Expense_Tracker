"use client";

import { useActionState, useRef, useEffect } from "react";
import {
  setMemberPassword,
  type MemberState,
} from "@/app/(app)/settings/actions";

const initialState: MemberState = { error: null, ok: null };

export default function SetPasswordForm({
  members,
}: {
  members: { id: string; name: string; email: string; can_sign_in: boolean }[];
}) {
  const [state, formAction, pending] = useActionState(
    setMemberPassword,
    initialState
  );
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.ok]);

  return (
    <form ref={form} action={formAction} className="space-y-3">
      <select name="member_id" required defaultValue="" className="input">
        <option value="" disabled>
          Choose a member…
        </option>
        {/*
          The email is the label, not the name. Two people can share a display
          name — "Pragyan" the participant and "pragyanmaharjan6k" the Gmail
          account — and the email is what you actually type to sign in, so
          choosing by name alone sets the password on the wrong row.
        */}
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.email} — {member.name}
            {member.can_sign_in ? "" : " (no login yet)"}
          </option>
        ))}
      </select>

      <input
        type="password"
        name="password"
        required
        autoComplete="new-password"
        placeholder="New password"
        className="input"
      />

      <button disabled={pending} className="btn btn-primary w-full">
        {pending ? "Saving…" : "Set password"}
      </button>

      {state.error && <p className="alert alert-error">{state.error}</p>}
      {state.ok && <p className="alert" style={{ color: "var(--green)", borderColor: "rgb(70 216 144 / .2)" }}>{state.ok}</p>}

      <p className="text-xs muted">
        Also how an existing participant gets a login for the first time. This
        does not sign them out of sessions they already have.
      </p>
    </form>
  );
}
