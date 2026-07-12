"use client";

import { useState, useTransition } from "react";
import { addRecurring } from "@/app/(app)/subscriptions/actions";
import type { AppUser, Category, Vendor } from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";

export default function AddRecurring({
  categories,
  vendors,
  users,
  meId,
}: {
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  meId: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"NPR" | "USD">("USD");
  const [pending, start] = useTransition();

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        + Add subscription
      </button>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <form
        action={(fd) =>
          start(async () => {
            const result = await addRecurring(fd);
            setOpen(false);
            if (result?.error) window.alert(result.error);
          })
        }
        className="w-full md:max-w-lg card !rounded-b-none md:!rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add subscription</h2>
          <button type="button" onClick={() => setOpen(false)} className="muted px-2">
            ✕
          </button>
        </div>

        <input
          name="name"
          required
          placeholder="Name (e.g. Claude, Vercel)"
          className="input"
        />
        <div className="flex gap-2">
          <input
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Amount"
            className="input tnum flex-1"
          />
          <select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as "NPR" | "USD")}
            className="input !w-24"
          >
            <option value="NPR">NPR</option>
            <option value="USD">USD</option>
          </select>
          <select name="cycle" defaultValue="monthly" className="input !w-28">
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
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="input mt-1"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <select name="category_id" className="input">
            <option value="">Category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="vendor_id" className="input">
            <option value="">Vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <select name="paid_by_user_id" defaultValue={meId} className="input">
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              Paid by {u.name}
            </option>
          ))}
        </select>

        <ShareAllocationFields users={users} total={amount} currency={currency} />

        <button type="submit" disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Save subscription"}
        </button>
      </form>
    </div>
  );
}
