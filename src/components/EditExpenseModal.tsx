"use client";

import { useState, useTransition } from "react";
import { updateExpense } from "@/app/(app)/expenses/actions";
import type { AppUser, Category, Currency, Expense, Vendor } from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";

export default function EditExpenseModal({
  expense,
  categories,
  vendors,
  users,
  onClose,
}: {
  expense: Expense;
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(expense.amount));
  const [currency, setCurrency] = useState<Currency>(expense.currency);
  const [busy, start] = useTransition();

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <form
        action={(formData) =>
          start(async () => {
            const result = await updateExpense(formData);
            if (result.error) window.alert(result.error);
            else onClose();
          })
        }
        className="w-full md:max-w-lg card !rounded-b-none md:!rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
      >
        <input type="hidden" name="expense_id" value={expense.id} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Edit expense</h2>
          <button type="button" onClick={onClose} className="muted px-2">✕</button>
        </div>

        <div className="flex gap-2">
          <label className="block flex-1 text-xs muted">
            Amount
            <input
              name="amount"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="input tnum mt-1"
            />
          </label>
          <label className="block w-28 text-xs muted">
            Currency
            <select
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
              className="input mt-1"
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>

        {currency === "USD" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs muted">
              Actual NPR charged
              <input
                name="actual_npr_charged"
                inputMode="decimal"
                defaultValue={expense.actual_npr_charged ?? ""}
                placeholder="Optional"
                className="input tnum mt-1"
              />
            </label>
            <label className="block text-xs muted">
              Manual NPR/USD rate
              <input
                name="manual_rate"
                inputMode="decimal"
                defaultValue={expense.fx_source === "manual" ? expense.fx_rate_to_npr : ""}
                placeholder="Use NRB automatically"
                className="input tnum mt-1"
              />
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Payment date
            <input
              name="expense_date"
              type="date"
              required
              defaultValue={expense.expense_date}
              className="input mt-1"
            />
          </label>
          <label className="block text-xs muted">
            Billing month
            <input
              name="billing_month"
              type="month"
              defaultValue={expense.billing_month?.slice(0, 7) ?? expense.expense_date.slice(0, 7)}
              className="input mt-1"
            />
          </label>
          <label className="block text-xs muted">
            Paid by
            <select
              name="paid_by_user_id"
              defaultValue={expense.paid_by_user_id ?? ""}
              className="input mt-1"
            >
              {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label className="block text-xs muted">
            Category
            <select name="category_id" defaultValue={expense.category_id ?? ""} className="input mt-1">
              <option value="">—</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="block text-xs muted col-span-2">
            Vendor
            <select name="vendor_id" defaultValue={expense.vendor_id ?? ""} className="input mt-1">
              <option value="">—</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
        </div>

        <ShareAllocationFields
          users={users}
          total={amount}
          currency={currency}
          initialShares={(expense.expense_shares ?? []).map((share) => ({
            userId: share.user_id,
            amount: Number(share.amount),
          }))}
        />

        <label className="block text-xs muted">
          Client
          <input name="client" defaultValue={expense.client ?? ""} className="input mt-1" />
        </label>
        <label className="block text-xs muted">
          Note
          <textarea name="note" defaultValue={expense.note ?? ""} className="input mt-1 min-h-20" />
        </label>

        <button type="submit" disabled={busy} className="btn btn-primary w-full !h-12">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
