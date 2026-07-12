"use client";

import { useState, useTransition } from "react";
import {
  toggleReimbursed,
  deleteExpense,
  retryConversion,
} from "@/app/(app)/expenses/actions";
import type { AppUser, Category, Expense, Vendor } from "@/lib/types";
import EditExpenseModal from "./EditExpenseModal";

export default function ExpenseRowActions({
  expense,
  isReimbursed,
  pending,
  categories,
  vendors,
  users,
}: {
  expense: Expense;
  isReimbursed: boolean;
  pending: boolean;
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, startTransition] = useTransition();
  const id = expense.id;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="w-8 h-8 rounded-lg muted"
        aria-label="Row actions"
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-0 top-9 z-10 w-48 card !rounded-xl py-1 text-sm shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {pending && (
            <button
              className="w-full text-left px-3 py-2 hover:opacity-70"
              onClick={() =>
                startTransition(async () => {
                  await retryConversion(id);
                  setOpen(false);
                })
              }
            >
              Retry exchange rate
            </button>
          )}
          <button
            className="w-full text-left px-3 py-2 hover:opacity-70"
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:opacity-70"
            onClick={() =>
              startTransition(async () => {
                await toggleReimbursed(id, !isReimbursed);
                setOpen(false);
              })
            }
          >
            {isReimbursed ? "Mark not reimbursed" : "Mark reimbursed"}
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:opacity-70"
            style={{ color: "var(--red)" }}
            onClick={() =>
              startTransition(async () => {
                await deleteExpense(id);
                setOpen(false);
              })
            }
          >
            Delete
          </button>
        </div>
      )}
      {editing && (
        <EditExpenseModal
          expense={expense}
          categories={categories}
          vendors={vendors}
          users={users}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
