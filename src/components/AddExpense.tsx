"use client";

import { useEffect, useState, useTransition } from "react";
import { addExpense } from "@/app/(app)/expenses/actions";
import { npr, rateLabel } from "@/lib/format";
import type { AppUser, Category, Vendor } from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";

const today = () => new Date().toISOString().slice(0, 10);

export default function AddExpense({
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
  const [currency, setCurrency] = useState<"NPR" | "USD">("NPR");
  const [date, setDate] = useState(today());
  const [billingMonth, setBillingMonth] = useState(today().slice(0, 7));
  const [billingMonthTouched, setBillingMonthTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [showActual, setShowActual] = useState(false);
  const [actualNpr, setActualNpr] = useState("");
  const [rate, setRate] = useState<{ rate: number; rateDate: string } | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (currency !== "USD") {
      setRate(null);
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    fetch(`/api/fx?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRate(d?.rate ? d : null);
      })
      .finally(() => !cancelled && setRateLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currency, date]);

  const amt = Number(amount) || 0;
  const actual = Number(actualNpr) || 0;
  const estNpr = rate ? amt * rate.rate : null;
  const effectiveRate = actual > 0 && amt > 0 ? actual / amt : null;

  function submit(formData: FormData) {
    startTransition(async () => {
      await addExpense(formData);
      setAmount("");
      setActualNpr("");
      setShowActual(false);
      setBillingMonth(today().slice(0, 7));
      setBillingMonthTouched(false);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        + Add expense
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <form
        action={submit}
        className="w-full md:max-w-lg card !rounded-b-none md:!rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add expense</h2>
          <button type="button" onClick={() => setOpen(false)} className="muted px-2">
            ✕
          </button>
        </div>

        {/* Amount + currency */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs muted">Amount</label>
            <input
              name="amount"
              inputMode="decimal"
              autoFocus
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="input tnum !h-14 text-2xl font-bold mt-1"
            />
          </div>
          <div className="w-28">
            <label className="text-xs muted">Currency</label>
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as "NPR" | "USD")}
              className="input !h-14 mt-1"
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        {/* USD conversion preview */}
        {currency === "USD" && (
          <div
            className="rounded-xl p-3 text-sm"
            style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}
          >
            {rateLoading ? (
              <span className="muted">Fetching NRB rate…</span>
            ) : rate ? (
              <>
                <div className="flex justify-between">
                  <span className="muted">{rateLabel(rate.rate)}</span>
                  <span className="text-xs muted">NRB · {rate.rateDate}</span>
                </div>
                <div className="tnum font-semibold mt-1">≈ {npr(estNpr)}</div>
              </>
            ) : (
              <span style={{ color: "var(--amber)" }}>
                No NRB rate available — enter a rate manually below or save as pending.
              </span>
            )}

            <button
              type="button"
              onClick={() => setShowActual((s) => !s)}
              className="mt-2 text-sm underline underline-offset-2"
              style={{ color: "var(--accent)" }}
            >
              {showActual ? "Hide" : "Know the actual NPR amount charged?"}
            </button>

            {showActual && (
              <div className="mt-2">
                <label className="text-xs muted">
                  Actual NPR charged (from your statement)
                </label>
                <input
                  name="actual_npr_charged"
                  inputMode="decimal"
                  value={actualNpr}
                  onChange={(e) => setActualNpr(e.target.value)}
                  placeholder="e.g. 3140"
                  className="input tnum mt-1"
                />
                {effectiveRate && (
                  <div className="text-xs mt-1" style={{ color: "var(--green)" }}>
                    Effective rate: {rateLabel(effectiveRate)} — overrides the estimate
                  </div>
                )}
              </div>
            )}

            {!rate && !showActual && (
              <input
                name="manual_rate"
                inputMode="decimal"
                placeholder="Manual rate (NPR per USD)"
                className="input tnum mt-2"
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Date">
            <input
              name="expense_date"
              type="date"
              value={date}
              onChange={(e) => {
                const nextDate = e.target.value;
                setDate(nextDate);
                if (!billingMonthTouched) setBillingMonth(nextDate.slice(0, 7));
              }}
              className="input"
            />
          </Field>
          <Field label="Paid by">
            <select name="paid_by_user_id" defaultValue={meId} className="input">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {!u.is_core_member ? " (manual split)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Billing month">
            <input
              name="billing_month"
              type="month"
              value={billingMonth}
              onChange={(e) => {
                setBillingMonth(e.target.value);
                setBillingMonthTouched(true);
              }}
              className="input"
            />
          </Field>
          <Field label="Category">
            <select name="category_id" className="input">
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendor">
            <select name="vendor_id" className="input">
              <option value="">—</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ShareAllocationFields users={users} total={amount} currency={currency} />

        <Field label="Client (optional)">
          <input name="client" placeholder="e.g. Hotel Everest" className="input" />
        </Field>
        <Field label="Note (optional)">
          <input name="note" className="input" />
        </Field>

        <button type="submit" disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Save expense"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
