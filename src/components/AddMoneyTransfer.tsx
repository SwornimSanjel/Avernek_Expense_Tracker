"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addMoneyTransfer,
  type FundsFormState,
} from "@/app/(app)/funds/actions";
import type { MoneyAccountBalance } from "@/lib/funds";

const initialState: FundsFormState = { error: null, ok: null };

function today() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function AddMoneyTransfer({ balances }: { balances: MoneyAccountBalance[] }) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(balances[0]?.account.id ?? "");
  const [toId, setToId] = useState(balances[1]?.account.id ?? "");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [state, action, pending] = useActionState(addMoneyTransfer, initialState);
  const from = useMemo(() => balances.find((item) => item.account.id === fromId), [balances, fromId]);
  const to = useMemo(() => balances.find((item) => item.account.id === toId), [balances, toId]);
  const effectiveRate = Number(fromAmount) > 0 && Number(toAmount) > 0
    ? Number(fromAmount) / Number(toAmount)
    : null;

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={balances.length < 2} className="btn btn-primary">⇄ Move / exchange</button>
      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Move or exchange company money</h2>
                <p className="text-xs muted mt-1">A transfer changes account balances; it is not income or an expense.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn">✕</button>
            </div>
            <label className="block">
              <span className="field-label">From account</span>
              <select name="from_account_id" value={fromId} onChange={(event) => setFromId(event.target.value)} className="input mt-1">
                {balances.map((item) => (
                  <option key={item.account.id} value={item.account.id} disabled={item.account.id === toId}>
                    {item.account.name} · {item.balance.toLocaleString("en-NP")} {item.account.currency}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Amount leaving ({from?.account.currency ?? "—"})</span>
                <input name="from_amount" type="number" min="0.01" step="0.01" required value={fromAmount} onChange={(event) => setFromAmount(event.target.value)} placeholder="3070" className="input tnum mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Amount received ({to?.account.currency ?? "—"})</span>
                <input name="to_amount" type="number" min="0.01" step="0.01" required value={toAmount} onChange={(event) => setToAmount(event.target.value)} placeholder="20" className="input tnum mt-1" />
              </label>
            </div>
            <label className="block">
              <span className="field-label">To account</span>
              <select name="to_account_id" value={toId} onChange={(event) => setToId(event.target.value)} className="input mt-1">
                {balances.map((item) => (
                  <option key={item.account.id} value={item.account.id} disabled={item.account.id === fromId}>
                    {item.account.name} · {item.account.currency}
                  </option>
                ))}
              </select>
            </label>
            {effectiveRate && from?.account.currency !== to?.account.currency && (
              <div className="alert">Effective exchange: 1 {to?.account.currency} = {effectiveRate.toLocaleString("en-NP", { maximumFractionDigits: 4 })} {from?.account.currency}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Transfer date</span>
                <input name="transfer_date" type="date" required defaultValue={today()} className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Note</span>
                <input name="note" placeholder="e.g. Bought USD for VPS" className="input mt-1" />
              </label>
            </div>
            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending} className="btn btn-primary w-full !h-12">{pending ? "Moving…" : "Record transfer"}</button>
          </form>
        </div>
      )}
    </>
  );
}
