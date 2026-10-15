"use client";

import { useTransition } from "react";
import { setCoreMember, setPartner } from "@/app/(app)/settings/actions";

/** Old default split on/off — only used by expenses saved without exact shares. */
export default function TeamToggle({
  id,
  isCore,
}: {
  id: string;
  isCore: boolean;
}) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isCore}
      disabled={busy}
      onClick={() => start(() => setCoreMember(id, !isCore))}
      className={`switch ${isCore ? "switch-on" : ""}`}
      title={isCore ? "Included when an old expense has no exact split" : "Used only when picked in a split"}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** Partner on/off — whether this person shows in rankings and pickers. */
export function PartnerToggle({ id, isPartner }: { id: string; isPartner: boolean }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPartner}
      disabled={busy}
      onClick={() => start(() => setPartner(id, !isPartner))}
      className={`switch ${isPartner ? "switch-on" : ""}`}
      title={isPartner ? "Partner — shown in totals and pickers" : "Login only — hidden from totals and pickers"}
    >
      <span className="switch-knob" />
    </button>
  );
}
