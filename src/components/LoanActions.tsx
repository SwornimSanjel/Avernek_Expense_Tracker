"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  markLoanRepaid,
  saveMoneyLoan,
  undoLoanRepaid,
  type FundsFormState,
} from "@/app/(app)/funds/actions";
import { formatIncomeMoney, todayIso } from "@/lib/income";
import { accountShortName, type MoneyAccountBalance } from "@/lib/funds";
import type { MoneyAccount, MoneyLoan } from "@/lib/types";
import Icon from "./Icons";

const initialState: FundsFormState = { error: null, ok: null };

/**
 * Lend company money to a person — or correct a loan already recorded. The
 * money leaves the chosen account now and comes back when it is marked paid.
 * Deliberately simple: who, how much, from where, when. No due date, no
 * interest.
 */
export function LendMoney({
  balances,
  people,
  loan,
  compact,
}: {
  balances: MoneyAccountBalance[];
  /** Names offered for "who took it"; any other name can be typed. */
  people: string[];
  loan?: MoneyLoan;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveMoneyLoan, initialState);
  const usable = balances.filter((item) => item.account.is_active);
  const [accountId, setAccountId] = useState(
    loan?.money_account_id ??
      usable.find((item) => item.account.kind === "personal_custody")?.account.id ??
      usable[0]?.account.id ??
      ""
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  const selected = usable.find((item) => item.account.id === accountId);
  const ownAmount =
    loan && !loan.repaid_on && loan.money_account_id === accountId ? Number(loan.amount) : 0;

  return (
    <>
      {loan ? (
        <button type="button" onClick={() => setOpen(true)} className="icon-btn !w-8 !h-8" aria-label="Edit loan" title="Edit loan">
          <Icon name="edit" size={14} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`btn ${compact ? "!h-9 !px-3 text-sm" : ""}`}>
          <Icon name="user" size={14} /> Lend money
        </button>
      )}

      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
            {loan && <input type="hidden" name="loan_id" value={loan.id} />}
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">{loan ? "Edit loan" : "Lend company money"}</h2>
                <p className="text-xs muted">
                  The money leaves the account now and comes back when you mark it paid back. It is not an
                  expense and repaying it is not income.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">
                ✕
              </button>
            </div>

            <label className="block">
              <span className="field-label">Who took it?</span>
              <input
                name="borrower_name"
                required
                list="loan-people"
                defaultValue={loan?.borrower_name ?? ""}
                placeholder="e.g. Swornim"
                autoFocus={!loan}
                className="input mt-1"
              />
              <datalist id="loan-people">
                {people.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>

            <div>
              <span className="field-label">From which account?</span>
              <div className="choice-grid mt-2">
                {usable.map((item) => (
                  <button
                    key={item.account.id}
                    type="button"
                    onClick={() => setAccountId(item.account.id)}
                    className={`funding-choice ${accountId === item.account.id ? "funding-choice-active" : ""}`}
                  >
                    <strong>{accountShortName(item.account)}</strong>
                    <span>
                      {formatIncomeMoney(
                        Math.max(0, item.free + (loan && !loan.repaid_on && loan.money_account_id === item.account.id ? Number(loan.amount) : 0)),
                        item.account.currency
                      )}{" "}
                      free to lend
                    </span>
                  </button>
                ))}
              </div>
              <input type="hidden" name="money_account_id" value={accountId} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">How much ({selected?.account.currency ?? "NPR"})</span>
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={loan ? Number(loan.amount) : ""}
                  max={selected ? Math.max(0, selected.free + ownAmount) || undefined : undefined}
                  placeholder="10000"
                  className="input tnum mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">When was it taken?</span>
                <input name="lent_on" type="date" required defaultValue={loan?.lent_on ?? todayIso()} className="input mt-1" />
              </label>
            </div>

            <label className="block">
              <span className="field-label">Note (optional)</span>
              <input name="note" defaultValue={loan?.note ?? ""} placeholder="What it was for" className="input mt-1" />
            </label>

            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending || !accountId} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : loan ? "Save loan" : "Record loan"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/**
 * "Paid back": the amount returns to an account — the one it came from unless
 * it was handed back somewhere else.
 */
export function MarkLoanRepaid({
  loan,
  accounts,
}: {
  loan: MoneyLoan;
  accounts: MoneyAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markLoanRepaid, initialState);
  const source = accounts.find((account) => account.id === loan.money_account_id);
  const options = accounts.filter(
    (account) => account.is_active && account.currency === (source?.currency ?? "NPR")
  );
  const [accountId, setAccountId] = useState(loan.money_account_id);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary !h-8 !px-3 text-xs">
        <Icon name="check" size={13} /> Mark paid back
      </button>
      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
            <input type="hidden" name="loan_id" value={loan.id} />
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Paid back</h2>
                <p className="text-xs muted">
                  {loan.borrower_name} returns {formatIncomeMoney(Number(loan.amount), source?.currency ?? "NPR")}. The
                  account balance goes back up and the loan is closed.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">
                ✕
              </button>
            </div>

            <div>
              <span className="field-label">Paid back into</span>
              <div className="choice-grid mt-2">
                {options.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setAccountId(account.id)}
                    className={`funding-choice ${accountId === account.id ? "funding-choice-active" : ""}`}
                  >
                    <strong>{accountShortName(account)}</strong>
                    <span>{account.id === loan.money_account_id ? "Same account it came from" : account.name}</span>
                  </button>
                ))}
              </div>
              <input type="hidden" name="repaid_to_account_id" value={accountId} />
            </div>

            <label className="block">
              <span className="field-label">Date paid back</span>
              <input
                name="repaid_on"
                type="date"
                required
                min={loan.lent_on}
                defaultValue={todayIso()}
                className="input mt-1"
              />
            </label>

            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : "Mark paid back"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/** Reopen a loan that was marked paid back by mistake. */
export function UndoLoanRepaid({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="btn !h-8 !px-3 text-xs"
      onClick={() =>
        window.confirm("Mark this loan as not paid back yet? The amount leaves the account again.") &&
        start(() => undoLoanRepaid(id))
      }
    >
      {pending ? "…" : "Undo"}
    </button>
  );
}
