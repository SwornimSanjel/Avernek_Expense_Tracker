"use client";

import { useTransition } from "react";
import { setCoreMember } from "@/app/(app)/settings/actions";

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
      className={isCore ? "btn btn-primary !h-8 !px-3 text-xs" : "btn !h-8 !px-3 text-xs"}
    >
      {isCore ? "Core member" : "Guest"}
    </button>
  );
}
