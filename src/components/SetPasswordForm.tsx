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
  members: { id: string; name: string; can_sign_in: boolean }[];
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
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
            {member.can_sign_in ? "" : " — no login yet"}
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

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}

      <p className="text-xs muted">
        Also how an existing participant gets a login for the first time. This
        does not sign them out of sessions they already have.
      </p>
    </form>
  );
}
