"use client";

import { useActionState, useRef, useEffect } from "react";
import { addMember, type MemberState } from "@/app/(app)/settings/actions";

const initialState: MemberState = { error: null, ok: null };

export default function AddMemberForm() {
  const [state, formAction, pending] = useActionState(addMember, initialState);
  const form = useRef<HTMLFormElement>(null);

  // Clear the fields after a success so the next person can be added straight
  // away without stale values (especially the password) sitting in the inputs.
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={formAction} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <input name="name" required placeholder="Name" className="input" />
        <input
          type="email"
          name="email"
          required
          placeholder="name@avernek.com"
          className="input"
        />
      </div>

      <input
        type="password"
        name="password"
        autoComplete="new-password"
        placeholder="Password — leave empty for participant only"
        className="input"
      />

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="checkbox-row">
          <input type="checkbox" name="is_partner" defaultChecked />
          <span><strong>Partner</strong><small>Shown in investment totals and payer lists</small></span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" name="is_admin" />
          <span><strong>Administrator</strong><small>Can add, edit and delete everything</small></span>
        </label>
      </div>

      <button disabled={pending} className="btn btn-primary w-full">
        {pending ? "Adding…" : "Add member"}
      </button>

      {state.error && <p className="alert alert-error">{state.error}</p>}
      {state.ok && <p className="alert" style={{ color: "var(--green)", borderColor: "rgb(70 216 144 / .2)" }}>{state.ok}</p>}

      <p className="text-[13px] muted">
        No password = they can be picked as a payer and split into, but cannot sign in. Non-administrators get read-only access.
      </p>
    </form>
  );
}
