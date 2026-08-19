"use client";

import { useState, useTransition } from "react";
import {
  toggleReimbursed,
  deleteExpense,
  retryConversion,
} from "@/app/(app)/expenses/actions";
import type { AppUser, Category, Expense, MoneyAccount, Vendor } from "@/lib/types";
import EditExpenseModal from "./EditExpenseModal";
import Icon from "./Icons";

export default function ExpenseRowActions({
  expense,
  isReimbursed,
  pending,
  categories,
  vendors,
  users,
  moneyAccounts,
}: {
  expense: Expense;
  isReimbursed: boolean;
  pending: boolean;
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  moneyAccounts: MoneyAccount[];
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
        className="icon-btn !w-8 !h-8"
        aria-label="Row actions"
      >
        <Icon name="more" size={17} />
      </button>
      {open && (
        <div
            className="absolute right-0 top-9 z-20 w-48 card !rounded-xl p-1 text-xs shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {pending && (
            <button
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[.04]"
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
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[.04]"
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[.04]"
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
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[.04]"
            style={{ color: "var(--red)" }}
            onClick={() => {
              if (!window.confirm("Delete this expense? This cannot be undone.")) return;
              startTransition(async () => {
                await deleteExpense(id);
                setOpen(false);
              });
            }}
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
          moneyAccounts={moneyAccounts}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
