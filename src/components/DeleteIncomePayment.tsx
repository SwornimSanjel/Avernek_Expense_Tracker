"use client";

import { useTransition } from "react";
import { deleteIncomePayment } from "@/app/(app)/income/actions";
import Icon from "./Icons";

export default function DeleteIncomePayment({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        window.confirm("Delete this payment record? The client balance will increase again.") &&
        startTransition(() => deleteIncomePayment(id))
      }
      className="icon-btn !w-8 !h-8"
      style={{ color: "var(--red)" }}
      aria-label="Delete payment"
      title="Delete payment"
    >
      {pending ? "…" : <Icon name="trash" size={14} />}
    </button>
  );
}
