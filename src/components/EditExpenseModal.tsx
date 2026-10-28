"use client";

import Icon from "@/components/Icons";
import { pickerPeople } from "@/lib/people";
import { useState, useTransition } from "react";
import { updateExpense } from "@/app/(app)/expenses/actions";
import type { Currency, Expense, ExpenseFundingSource } from "@/lib/types";
import ShareAllocationFields from "./ShareAllocationFields";
import ExpenseBillFields, { type BillAnswer } from "./ExpenseBillFields";
import { useExpenseFormData } from "./ExpenseFormData";

export default function EditExpenseModal({
  expense,
  onClose,
}: {
  expense: Expense;
  onClose: () => void;
}) {
  const { categories, vendors, users: allUsers, moneyAccounts, clients } = useExpenseFormData();
  const users = pickerPeople(allUsers, [expense.paid_by_user_id, ...(expense.expense_shares ?? []).map((share) => share.user_id)]);
  const [amount, setAmount] = useState(String(expense.amount));
  const [currency, setCurrency] = useState<Currency>(expense.currency);
  const [fundingSource, setFundingSource] = useState<ExpenseFundingSource>(
    expense.funding_source ?? "personal"
  );
  const [moneyAccountId, setMoneyAccountId] = useState(expense.money_account_id ?? "");
  const [busy, start] = useTransition();
  const [filesBusy, setFilesBusy] = useState(false);
  const savedPhotos = expense.attachments?.length ?? 0;
  const initialBill: BillAnswer = expense.has_bill === true ? "yes" : expense.has_bill === false ? "no" : "";
  const [billAnswer, setBillAnswer] = useState<BillAnswer>(initialBill);
  const [billPhotos, setBillPhotos] = useState(0);
  const [billError, setBillError] = useState<string | null>(null);
  const matchingAccounts = moneyAccounts.filter(
    (account) =>
      account.is_active &&
      (account.currency === currency || (currency === "USD" && account.currency === "NPR"))
  );
  const selectedMoneyAccount = matchingAccounts.find((account) => account.id === moneyAccountId);
  const isNprAccountPayingUsd =
    currency === "USD" && selectedMoneyAccount?.currency === "NPR";

  return (
    <div className="modal-backdrop">
      <form
        // Checked in onSubmit, not in the action: React resets a form after
        // every action call, which would wipe the edits whenever it fails.
        onSubmit={(event) => {
          // Older expenses may stay unanswered; a "Yes" needs a photo on file.
          const problem = billAnswer === "yes" && savedPhotos + billPhotos === 0 ? "Add a photo of the bill." : null;
          setBillError(problem);
          if (problem) {
            event.preventDefault();
            document.getElementById("expense-bill")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }}
        action={(formData) =>
          start(async () => {
            const result = await updateExpense(formData);
            if (result.error) window.alert(result.error);
            else onClose();
          })
        }
        className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4"
      >
        <input type="hidden" name="expense_id" value={expense.id} />
        <div className="modal-header">
          <div><h2 className="text-lg font-bold">Edit expense</h2><p className="text-[13px] muted mt-1">Keep founder investment separate from company operating money.</p></div>
          <button type="button" onClick={onClose} className="icon-btn"><Icon name="close" size={16} /></button>
        </div>

        <div className="flex gap-2">
          <label className="block flex-1 text-[13px] muted">
            Amount
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="input tnum mt-1"
            />
          </label>
          <label className="block w-28 text-[13px] muted">
            Currency
            <select
              name="currency"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value as Currency);
                setMoneyAccountId("");
              }}
              className="input mt-1"
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>

        {currency === "USD" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[13px] muted">
              Actual NPR charged{isNprAccountPayingUsd ? " · required" : ""}
              <input
                name="actual_npr_charged"
                type="number"
                min="0.01"
                step="0.01"
                required={isNprAccountPayingUsd}
                defaultValue={expense.actual_npr_charged ?? ""}
                placeholder="Optional"
                className="input tnum mt-1"
              />
            </label>
            <label className="block text-[13px] muted">
              Manual NPR/USD rate
              <input
                name="manual_rate"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={expense.fx_source === "manual" ? expense.fx_rate_to_npr : ""}
                placeholder="Use NRB automatically"
                className="input tnum mt-1"
              />
            </label>
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
              <span>Uses client-earned company money</span>
            </button>
          </div>
          <input type="hidden" name="funding_source" value={fundingSource} />
          {fundingSource === "company_funds" && (
            <div className="mt-3">
              <label className="block text-[13px] muted">
                Paid from which company-money account?
                <select
                  name="money_account_id"
                  required
                  value={matchingAccounts.some((account) => account.id === moneyAccountId) ? moneyAccountId : ""}
                  onChange={(event) => setMoneyAccountId(event.target.value)}
                  className="input mt-1"
                >
                  <option value="" disabled>Choose account</option>
                  {matchingAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.currency !== currency ? ` · charged in ${account.currency}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-help">This reduces the selected company-money balance and is excluded from founder/team investment.</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[13px] muted">
            Payment date
            <input
              name="expense_date"
              type="date"
              required
              defaultValue={expense.expense_date}
              className="input mt-1"
            />
          </label>
          <label className="block text-[13px] muted">
            Billing month
            <input
              name="billing_month"
              type="month"
              defaultValue={expense.billing_month?.slice(0, 7) ?? expense.expense_date.slice(0, 7)}
              className="input mt-1"
            />
          </label>
          {fundingSource === "personal" && (
            <label className="block text-[13px] muted">
              Invested / paid personally by
              <select
                name="paid_by_user_id"
                defaultValue={expense.paid_by_user_id ?? ""}
                className="input mt-1"
              >
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[13px] muted">
            Category
            <select name="category_id" defaultValue={expense.category_id ?? ""} className="input mt-1">
              <option value="">—</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="block text-[13px] muted col-span-2">
            Vendor
            <select name="vendor_id" defaultValue={expense.vendor_id ?? ""} className="input mt-1">
              <option value="">—</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
        </div>

        {fundingSource === "personal" && (
          <ShareAllocationFields
            users={users}
            total={amount}
            currency={currency}
            initialShares={(expense.expense_shares ?? []).map((share) => ({
              userId: share.user_id,
              amount: Number(share.amount),
            }))}
          />
        )}

        <label className="block text-[13px] muted">
          Client / project (optional)
          <input
            name="client"
            list={`edit-expense-client-options-${expense.id}`}
            defaultValue={expense.client ?? ""}
            className="input mt-1"
          />
          <datalist id={`edit-expense-client-options-${expense.id}`}>
            {clients.map((client) => <option key={client} value={client} />)}
          </datalist>
          <span className="field-help">Leave blank when this is a shared company cost.</span>
        </label>
        <label className="block text-[13px] muted">
          Note
          <textarea name="note" defaultValue={expense.note ?? ""} className="input mt-1 min-h-20" />
        </label>

        <ExpenseBillFields
          initial={initialBill}
          initialNumber={expense.bill_number ?? ""}
          initialPan={expense.seller_pan ?? ""}
          existing={expense.attachments ?? []}
          error={billError}
          onAnswer={(answer) => {
            setBillAnswer(answer);
            if (answer === "no") setBillPhotos(0);
            setBillError(null);
          }}
          onPhotoCount={(count) => {
            setBillPhotos(count);
            if (count > 0) setBillError(null);
          }}
          onBusyChange={setFilesBusy}
        />

        <button type="submit" disabled={busy || filesBusy} className="btn btn-primary w-full !h-12">
          {busy ? "Saving…" : filesBusy ? "Preparing photos…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
