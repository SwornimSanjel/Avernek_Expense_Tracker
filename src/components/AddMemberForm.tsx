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
  }, [state.ok]);

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

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_core_member" defaultChecked />
          Include in default split
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_admin" />
          Administrator
        </label>
      </div>

      <button disabled={pending} className="btn btn-primary w-full">
        {pending ? "Adding…" : "Add member"}
      </button>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}

      <p className="text-xs muted">
        No password means they can be picked as a payer and included in splits,
        but cannot sign in. Administrators can edit and delete everything;
        everyone else has read-only access.
      </p>
    </form>
  );
}
