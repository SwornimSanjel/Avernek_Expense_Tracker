"use client";

import { guardRequest } from "@/lib/stale-deploy";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  addCompanyBill,
  addTaxPayment,
  reimburseBill,
  type FundsFormState,
} from "@/app/(app)/funds/actions";
import { formatIncomeMoney, todayIso } from "@/lib/income";
import { accountShortName, type BillStatus, type MoneyAccountBalance } from "@/lib/funds";
import { vatInsideTotal } from "@/lib/tax";
import type { CompanyBill } from "@/lib/types";
import Icon from "./Icons";
import { BillDocuments } from "./DocumentSections";
import type { Attachment } from "@/lib/attachments";

const initialState: FundsFormState = { error: null, ok: null };

function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-header">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-[13px] muted mt-1">{subtitle}</p>}
      </div>
      <button type="button" onClick={onClose} className="icon-btn"><Icon name="close" size={16} /></button>
    </div>
  );
}

/**
 * A bill issued in Avernek's name (lawyer, rent, printing...) that someone paid
 * first. Its VAT is input VAT: it lowers the VAT owed to IRD.
 */
export function AddCompanyBill({
  bill,
  compact,
  files = [],
}: {
  bill?: CompanyBill;
  compact?: boolean;
  /** Scans / photos already saved on this bill. */
  files?: Attachment[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(guardRequest(addCompanyBill), initialState);
  const [total, setTotal] = useState(bill ? String(Number(bill.total_amount)) : "");
  const [isVatBill, setIsVatBill] = useState(bill ? Number(bill.vat_amount) > 0 : true);
  const [vat, setVat] = useState(bill ? String(Number(bill.vat_amount)) : "");
  const [vatEdited, setVatEdited] = useState(Boolean(bill));
  const vatValue = !isVatBill ? 0 : vatEdited ? Number(vat || 0) : vatInsideTotal(Number(total || 0));
  const [filesBusy, setFilesBusy] = useState(false);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <>
      {bill ? (
        <button type="button" onClick={() => setOpen(true)} className="icon-btn !w-8 !h-8" aria-label="Edit bill">
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`btn ${compact ? "!h-9 !px-3 text-sm" : ""}`}>
          <Icon name="receipt" size={15} /> Add VAT bill
        </button>
      )}
      {open && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
            {bill && <input type="hidden" name="bill_id" value={bill.id} />}
            <ModalHeader
              title={bill ? "Edit bill" : "Bill in Avernek's name"}
              subtitle="A bill issued to the company that was paid from somewhere else first. It waits here until the VAT account pays it back."
              onClose={() => setOpen(false)}
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className="field-label">What is the bill for?</span>
                <input name="description" required defaultValue={bill?.description ?? ""} placeholder="e.g. Lawyer service charge" className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Vendor (optional)</span>
                <input name="vendor_name" defaultValue={bill?.vendor_name ?? ""} className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Bill no. (optional)</span>
                <input name="bill_number" defaultValue={bill?.bill_number ?? ""} className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Bill total (incl. VAT)</span>
                <input
                  name="total_amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={total}
                  onChange={(event) => setTotal(event.target.value)}
                  placeholder="20340"
                  className="input tnum mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Bill date</span>
                <input name="bill_date" type="date" required defaultValue={bill?.bill_date ?? todayIso()} className="input mt-1" />
              </label>
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={isVatBill} onChange={(event) => setIsVatBill(event.target.checked)} />
              <span>
                <strong>VAT bill (13% included in the total)</strong>
                <small>The VAT inside it is input VAT — it reduces the VAT Avernek owes IRD.</small>
              </span>
            </label>
            {isVatBill && (
              <label className="block">
                <span className="field-label">VAT inside the bill</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={vatEdited ? vat : vatValue || ""}
                  onChange={(event) => {
                    setVatEdited(true);
                    setVat(event.target.value);
                  }}
                  className="input tnum mt-1"
                />
              </label>
            )}
            <input type="hidden" name="vat_amount" value={vatValue} />

            <label className="block">
              <span className="field-label">Who paid it first? (optional)</span>
              <input name="paid_by" defaultValue={bill?.paid_by ?? ""} placeholder="e.g. Swornim · non-VAT account" className="input mt-1" />
            </label>
            <label className="block">
              <span className="field-label">Note (optional)</span>
              <input name="note" defaultValue={bill?.note ?? ""} className="input mt-1" />
            </label>

            <BillDocuments name="bill_files" kind="company_bill" title="Bill scan / photo" existing={files} onBusyChange={setFilesBusy} />

            {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
            <button disabled={pending || filesBusy} className="btn btn-primary w-full !h-12">
              {pending ? "Saving…" : filesBusy ? "Preparing photos…" : bill ? "Save bill" : "Add bill"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/**
 * Pay a bill back from the VAT account. The most it allows is what the account
 * can spend after keeping VAT aside — never the VAT itself.
 */
export function ReimburseBill({
  bills,
  balances,
  billId,
  compact,
}: {
  bills: BillStatus[];
  balances: MoneyAccountBalance[];
  billId?: string;
  compact?: boolean;
}) {
  const open_ = bills.filter((item) => item.pending > 0);
  const vatAccount = balances.find((item) => item.account.kind === "company_bank") ?? balances[0];
  const nonVat = balances.find((item) => item.account.kind === "personal_custody") ?? balances[1];
  const [open, setOpen] = useState(false);
  // Derived on every render: the list of bills can change after this mounts.
  const [picked, setSelected] = useState(billId ?? "");
  const selected = open_.some((item) => item.bill.id === picked) ? picked : open_[0]?.bill.id ?? "";
  const [fromPicked, setFromId] = useState("");
  const [toPicked, setToId] = useState("");
  const fromId = fromPicked || vatAccount?.account.id || "";
  const toId = toPicked || nonVat?.account.id || "";
  const [state, action, pending] = useActionState(guardRequest(reimburseBill), initialState);
  const bill = bills.find((item) => item.bill.id === selected);
  const from = balances.find((item) => item.account.id === fromId);
  const room = Math.max(0, from?.free ?? 0);
  const suggested = Math.min(bill?.pending ?? 0, room);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        disabled={!open_.length}
        onClick={() => setOpen(true)}
        className={`btn ${billId ? "btn-sm" : open_.length ? "btn-primary" : ""} ${compact ? "btn-sm" : ""}`}
        title={open_.length ? undefined : "No bill is waiting to be reimbursed"}
      >
        {billId ? "Reimburse" : "Reimburse a bill"}
      </button>
    );
  }

  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-lg p-5 md:p-6 space-y-4">
        <ModalHeader
          title="Reimburse a bill"
          subtitle="Money moves from the VAT account and the bill becomes an official company expense."
          onClose={() => setOpen(false)}
         />

        <label className="block">
          <span className="field-label">Bill</span>
          <select name="bill_id" value={selected} onChange={(event) => setSelected(event.target.value)} className="input mt-1">
            {open_.map((item) => (
              <option key={item.bill.id} value={item.bill.id}>
                {item.bill.description} · {formatIncomeMoney(item.pending, "NPR")} still to reimburse
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">From</span>
            <select name="from_account_id" value={fromId} onChange={(event) => setFromId(event.target.value)} className="input mt-1">
              {balances.map((item) => (
                <option key={item.account.id} value={item.account.id} disabled={item.account.id === toId}>
                  {accountShortName(item.account)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">To</span>
            <select name="to_account_id" value={toId} onChange={(event) => setToId(event.target.value)} className="input mt-1">
              {balances.map((item) => (
                <option key={item.account.id} value={item.account.id} disabled={item.account.id === fromId}>
                  {accountShortName(item.account)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {from && (
          <dl className="money-breakdown">
            <div>
              <dt>In {accountShortName(from.account)}</dt>
              <dd>{formatIncomeMoney(from.balance, from.account.currency)}</dd>
            </div>
            <div>
              <dt>− VAT kept aside for IRD</dt>
              <dd>{formatIncomeMoney(from.vatReserved, from.account.currency)}</dd>
            </div>
            <div className="money-breakdown-total">
              <dt>= Can be used to reimburse</dt>
              <dd>{formatIncomeMoney(room, from.account.currency)}</dd>
            </div>
          </dl>
        )}
        {bill && room < bill.pending && (
          <p className="text-[13px]" style={{ color: "var(--amber)" }}>
            Not enough room for the whole bill. Reimburse {formatIncomeMoney(room, "NPR")} now; the rest stays pending
            until more money comes in.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Amount</span>
            <input
              key={`${selected}-${fromId}`}
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={suggested > 0 ? suggested : ""}
              className="input tnum mt-1"
            />
          </label>
          <label className="block">
            <span className="field-label">Date</span>
            <input name="transfer_date" type="date" required defaultValue={todayIso()} className="input mt-1" />
          </label>
        </div>
        <label className="block">
          <span className="field-label">Note (optional)</span>
          <input name="note" placeholder="e.g. Lawyer bill reimbursed" className="input mt-1" />
        </label>

        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending || !selected} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Record reimbursement"}
        </button>
      </form>
    </div>
  );
}

/** VAT deposited to IRD. It lowers the account and the VAT still owed. */
export function PayVat({ balances, vatOwed }: { balances: MoneyAccountBalance[]; vatOwed: number }) {
  const vatAccount = balances.find((item) => item.account.kind === "company_bank") ?? balances[0];
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(guardRequest(addTaxPayment), initialState);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn !h-9 text-sm">
        Pay VAT to IRD
      </button>
    );
  }
  return (
    <div className="modal-backdrop">
      <form action={action} className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
        <ModalHeader
          title="VAT paid to IRD"
          subtitle={`Estimated VAT still owed: ${formatIncomeMoney(vatOwed, "NPR")}. Enter what was actually paid.`}
          onClose={() => setOpen(false)}
         />
        <label className="block">
          <span className="field-label">Paid from</span>
          <select name="money_account_id" defaultValue={vatAccount?.account.id ?? ""} className="input mt-1">
            {balances.map((item) => (
              <option key={item.account.id} value={item.account.id}>
                {accountShortName(item.account)} · {item.account.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Amount paid</span>
            <input name="amount" type="number" min="0.01" step="0.01" required defaultValue={vatOwed > 0 ? vatOwed : ""} className="input tnum mt-1" />
          </label>
          <label className="block">
            <span className="field-label">Date paid</span>
            <input name="paid_on" type="date" required defaultValue={todayIso()} className="input mt-1" />
          </label>
          <label className="block">
            <span className="field-label">For month (optional)</span>
            <input name="period_label" placeholder="e.g. Ashwin 2083" className="input mt-1" />
          </label>
          <label className="block">
            <span className="field-label">Voucher / reference</span>
            <input name="reference" className="input mt-1" />
          </label>
        </div>
        <label className="block">
          <span className="field-label">Note (optional)</span>
          <input name="note" className="input mt-1" />
        </label>
        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}
        <button disabled={pending} className="btn btn-primary w-full !h-12">
          {pending ? "Saving…" : "Record VAT payment"}
        </button>
      </form>
    </div>
  );
}

/** A small trash button for a server-side delete. */
export function ConfirmDelete({
  id,
  action,
  message,
}: {
  id: string;
  action: (id: string) => Promise<void>;
  message: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        window.confirm(message) &&
        start(async () => {
          try {
            await action(id);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : "Could not delete.");
          }
        })
      }
      className="icon-btn !w-8 !h-8"
      style={{ color: "var(--red)" }}
      aria-label="Delete"
    >
      {pending ? "…" : <Icon name="trash" size={14} />}
    </button>
  );
}
