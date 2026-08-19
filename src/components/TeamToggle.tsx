"use client";

import { useTransition } from "react";
import { setCoreMember } from "@/app/(app)/settings/actions";
import Icon from "./Icons";

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
      disabled={busy}
      onClick={() => start(() => setCoreMember(id, !isCore))}
      className="btn !h-8 !px-3 text-[11px]"
      style={isCore ? { color: "#b8a0fb", borderColor: "rgb(139 92 246 / .22)", background: "var(--accent-soft)" } : undefined}
      title={
        isCore
          ? "Included when an older expense has no exact split"
          : "Used only when explicitly selected in a split"
      }
    >
      {isCore && <Icon name="check" size={13} />}
      {isCore ? "Default split" : "Manual only"}
    </button>
  );
}
