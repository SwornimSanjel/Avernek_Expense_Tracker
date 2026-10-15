"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  clients,
}: {
  expense: Expense;
  isReimbursed: boolean;
  pending: boolean;
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  moneyAccounts: MoneyAccount[];
  clients: string[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const id = expense.id;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="icon-btn !w-8 !h-8"
        aria-label="Expense actions"
        aria-expanded={open}
      >
        <Icon name="more" size={17} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu-pop"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
          >
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={15} /> Edit expense
            </button>
            {pending && (
              <button
                className="menu-item"
                onClick={() =>
                  startTransition(async () => {
                    await retryConversion(id);
                    setOpen(false);
                  })
                }
              >
                <Icon name="refresh" size={15} /> Retry exchange rate
              </button>
            )}
            <button
              className="menu-item"
              onClick={() =>
                startTransition(async () => {
                  await toggleReimbursed(id, !isReimbursed);
                  setOpen(false);
                })
              }
            >
              <Icon name="check" size={15} /> {isReimbursed ? "Mark not reimbursed" : "Mark reimbursed"}
            </button>
            <button
              className="menu-item"
              style={{ color: "var(--red)" }}
              onClick={() => {
                if (!window.confirm("Delete this expense? This cannot be undone.")) return;
                startTransition(async () => {
                  await deleteExpense(id);
                  setOpen(false);
                });
              }}
            >
              <Icon name="trash" size={15} /> Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {editing && (
        <EditExpenseModal
          expense={expense}
          categories={categories}
          vendors={vendors}
          users={users}
          moneyAccounts={moneyAccounts}
          clients={clients}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
