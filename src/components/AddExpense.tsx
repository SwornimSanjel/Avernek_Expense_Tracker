"use client";

import { useEffect, useState, useTransition } from "react";
import { addExpense } from "@/app/(app)/expenses/actions";
import { npr, rateLabel } from "@/lib/format";
import type {
  AppUser,
  Category,
  ExpenseFundingSource,
  MoneyAccount,
  Vendor,
} from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";

const today = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export default function AddExpense({
  categories,
  vendors,
  users,
  moneyAccounts,
  meId,
}: {
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  moneyAccounts: MoneyAccount[];
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
  const [fundingSource, setFundingSource] = useState<ExpenseFundingSource>("personal");
  const [moneyAccountId, setMoneyAccountId] = useState("");
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
  const matchingAccounts = moneyAccounts.filter(
    (account) =>
      account.is_active &&
      (account.currency === currency || (currency === "USD" && account.currency === "NPR"))
  );
  const selectedMoneyAccount = matchingAccounts.find((account) => account.id === moneyAccountId);
  const isNprAccountPayingUsd =
    currency === "USD" && selectedMoneyAccount?.currency === "NPR";

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await addExpense(formData);
        setAmount("");
        setActualNpr("");
        setShowActual(false);
        setMoneyAccountId("");
        setBillingMonth(today().slice(0, 7));
        setBillingMonthTouched(false);
        setOpen(false);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not save expense");
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <span className="text-base leading-none">＋</span> Add expense
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form
        action={submit}
        className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4"
      >
        <div className="modal-header">
          <div><h2 className="text-lg font-bold">Add expense</h2><p className="text-xs muted mt-1">Choose founder investment or the exact company-money account that paid.</p></div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        {/* Amount + currency */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs muted">Amount</label>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
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
              onChange={(e) => {
                setCurrency(e.target.value as "NPR" | "USD");
                setMoneyAccountId("");
              }}
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
                  Actual NPR charged (from your statement){isNprAccountPayingUsd ? " · required" : ""}
                </label>
                <input
                  name="actual_npr_charged"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required={isNprAccountPayingUsd}
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
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Manual rate (NPR per USD)"
                className="input tnum mt-2"
              />
            )}
          </div>
        )}

        <div className="card-soft p-3.5">
          <div className="field-label mb-2">Which money paid for this?</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFundingSource("personal")}
              className={`funding-choice ${fundingSource === "personal" ? "funding-choice-active" : ""}`}
            >
              <strong>Founder/team investment</strong>
              <span>Pre-registration or own-pocket money</span>
            </button>
            <button
              type="button"
              onClick={() => setFundingSource("company_funds")}
              className={`funding-choice ${fundingSource === "company_funds" ? "funding-choice-active" : ""}`}
            >
              <strong>Company operating money</strong>
              <span>Client-earned money in either company-use account</span>
            </button>
          </div>
          <input type="hidden" name="funding_source" value={fundingSource} />

          {fundingSource === "company_funds" && (
            <div className="mt-3">
              <Field label="Paid from which company-money account?">
                <select
                  name="money_account_id"
                  required
                  className="input"
                  value={moneyAccountId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setMoneyAccountId(nextId);
                    const nextAccount = matchingAccounts.find((account) => account.id === nextId);
                    if (currency === "USD" && nextAccount?.currency === "NPR") setShowActual(true);
                  }}
                >
                  <option value="" disabled>Choose account</option>
                  {matchingAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.currency !== currency ? ` · charged in ${account.currency}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              {matchingAccounts.length === 0 && (
                <p className="field-help" style={{ color: "var(--amber)" }}>
                  Create a {currency} account on the Company money page first.
                </p>
              )}
              <p className="field-help">
                {isNprAccountPayingUsd
                  ? "Enter the exact NPR charged above. That rupee amount—not the USD face value—will reduce this account."
                  : "This reduces the selected company-money balance and never counts as Swornim's or another founder's investment."}
              </p>
            </div>
          )}
        </div>

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
          {fundingSource === "personal" && (
            <Field label="Invested / paid personally by">
              <select name="paid_by_user_id" defaultValue={meId} className="input">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {!u.is_core_member ? " (manual split)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
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

        {fundingSource === "personal" && (
          <ShareAllocationFields users={users} total={amount} currency={currency} />
        )}

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
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
