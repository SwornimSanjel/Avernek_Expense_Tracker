"use client";

import { useState, useTransition } from "react";
import {
  logRenewalPaid,
  toggleActive,
  deleteRecurring,
} from "@/app/(app)/subscriptions/actions";
import type { AppUser, Category, Currency, Cycle, Recurring, Vendor } from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";
import EditRecurringModal from "./EditRecurringModal";

export default function RecurringRow({
  id,
  isActive,
  amount: initialAmount,
  currency,
  cycle,
  nextRenewalDate,
  paidByUserId,
  users,
  shares,
  recurring,
  categories,
  vendors,
}: {
  id: string;
  isActive: boolean;
  amount: number;
  currency: Currency;
  cycle: Cycle;
  nextRenewalDate: string;
  paidByUserId: string | null;
  users: AppUser[];
  shares: { userId: string; amount: number }[];
  recurring: Recurring;
  categories: Category[];
  vendors: Vendor[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(initialAmount));
  const [busy, start] = useTransition();
  const isAnnual = cycle === "annual";

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={busy}
        onClick={() => setOpen(true)}
        className="btn btn-primary !h-8 !px-3 text-xs"
      >
        Mark paid
      </button>
      <button
        disabled={busy}
        onClick={() => setEditing(true)}
        className="btn !h-8 !px-3 text-xs"
      >
        Edit
      </button>
      <button
        disabled={busy}
        onClick={() => start(() => toggleActive(id, !isActive))}
        className="btn !h-8 !px-3 text-xs"
      >
        {isActive ? "Pause" : "Resume"}
      </button>
      <button
        disabled={busy}
        onClick={() => start(() => deleteRecurring(id))}
        className="w-8 h-8 rounded-lg text-xs"
        style={{ color: "var(--red)" }}
        aria-label="Delete"
      >
        ✕
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
          <form
            action={(formData) =>
              start(async () => {
                await logRenewalPaid(formData);
                setOpen(false);
              })
            }
            className="w-full md:max-w-lg card !rounded-b-none md:!rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
          >
            <input type="hidden" name="recurring_id" value={id} />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  Log {isAnnual ? "annual" : "monthly"} payment
                </h2>
                <p className="text-xs muted">
                  Change this {isAnnual ? "renewal" : "month"} without changing future defaults.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="muted px-2">
                ✕
              </button>
            </div>

            <div className="flex gap-2">
              <label className="block flex-1 text-xs muted">
                Total charged
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="input tnum mt-1"
                />
              </label>
              <div className="w-24 pt-6 text-sm font-medium">{currency}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs muted">
                Payment date
                <input
                  name="expense_date"
                  type="date"
                  required
                  defaultValue={nextRenewalDate}
                  className="input mt-1"
                />
              </label>
              <label className="block text-xs muted">
                Billing month
                <input
                  name="billing_month"
                  type="month"
                  required
                  defaultValue={nextRenewalDate.slice(0, 7)}
                  className="input mt-1"
                />
              </label>
            </div>

            <label className="block text-xs muted">
              Paid to vendor by
              <select
                name="paid_by_user_id"
                defaultValue={paidByUserId ?? ""}
                className="input mt-1"
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>

            <ShareAllocationFields
              users={users}
              total={amount}
              currency={currency}
              initialShares={shares}
            />

            <label className="flex items-start gap-2 text-sm">
              <input name="update_defaults" type="checkbox" value="yes" className="mt-1" />
              <span>
                Use this amount, payer, and split for future {isAnnual ? "renewals" : "months"}
                <span className="block text-xs muted">
                  Leave off when this is a one-time historical arrangement.
                </span>
              </span>
            </label>

            <button type="submit" disabled={busy} className="btn btn-primary w-full !h-12">
              {busy ? "Saving…" : isAnnual ? "Save annual payment" : "Save this month"}
            </button>
          </form>
        </div>
      )}
      {editing && (
        <EditRecurringModal
          recurring={recurring}
          categories={categories}
          vendors={vendors}
          users={users}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
