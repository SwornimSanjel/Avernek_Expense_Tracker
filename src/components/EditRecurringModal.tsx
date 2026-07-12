"use client";

import { useState, useTransition } from "react";
import { updateRecurring } from "@/app/(app)/subscriptions/actions";
import type { AppUser, Category, Currency, Cycle, Recurring, Vendor } from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";

export default function EditRecurringModal({
  recurring,
  categories,
  vendors,
  users,
  onClose,
}: {
  recurring: Recurring;
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(recurring.amount));
  const [currency, setCurrency] = useState<Currency>(recurring.currency);
  const [busy, start] = useTransition();

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <form
        action={(formData) =>
          start(async () => {
            const result = await updateRecurring(formData);
            if (result.error) window.alert(result.error);
            else onClose();
          })
        }
        className="w-full md:max-w-lg card !rounded-b-none md:!rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
      >
        <input type="hidden" name="recurring_id" value={recurring.id} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Edit subscription</h2>
          <button type="button" onClick={onClose} className="muted px-2">✕</button>
        </div>

        <label className="block text-xs muted">
          Name
          <input name="name" required defaultValue={recurring.name} className="input mt-1" />
        </label>
        <div className="flex gap-2">
          <input
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="input tnum flex-1"
          />
          <select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            className="input !w-24"
          >
            <option value="NPR">NPR</option>
            <option value="USD">USD</option>
          </select>
          <select name="cycle" defaultValue={recurring.cycle as Cycle} className="input !w-28">
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>

        <label className="block text-xs muted">
          Next renewal date
          <input
            name="next_renewal_date"
            type="date"
            required
            defaultValue={recurring.next_renewal_date}
            className="input mt-1"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs muted">
            Category
            <select name="category_id" defaultValue={recurring.category_id ?? ""} className="input mt-1">
              <option value="">—</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="block text-xs muted">
            Vendor
            <select name="vendor_id" defaultValue={recurring.vendor_id ?? ""} className="input mt-1">
              <option value="">—</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs muted">
          Default payer
          <select name="paid_by_user_id" defaultValue={recurring.paid_by_user_id ?? ""} className="input mt-1">
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </label>

        <ShareAllocationFields
          users={users}
          total={amount}
          currency={currency}
          initialShares={(recurring.recurring_shares ?? []).map((share) => ({
            userId: share.user_id,
            amount: Number(share.amount),
          }))}
        />

        <button type="submit" disabled={busy} className="btn btn-primary w-full !h-12">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
