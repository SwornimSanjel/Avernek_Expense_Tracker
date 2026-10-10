"use client";

import { useEffect, useState } from "react";
import { formatIncomeMoney } from "@/lib/income";
import { TDS_RATE, VAT_RATE, billFromBankTotal, round2, tdsOn, vatOn } from "@/lib/tax";

type TdsMode = "none" | "auto" | "custom";

/**
 * One money-in amount split the way the bank statement and the VAT bill see it:
 *
 *   bill amount (revenue) + VAT on top − TDS the client withheld = reached the bank
 *
 * The person can type either the bill amount or what reached the bank; the other
 * side is worked out. Only the three final numbers are posted, through hidden
 * inputs, so the server never has to guess which one was typed.
 */
export default function TaxBreakdownFields({
  currency,
  amountName = "amount",
  vatName = "vat_amount",
  tdsName = "tds_amount",
  suggestedAmount,
  record,
  vatSuggested,
  tdsSuggested = false,
  remainingHint,
  onAmountChange,
}: {
  currency: string;
  amountName?: string;
  vatName?: string;
  tdsName?: string;
  /** Prefill for a new receipt, e.g. what is still owed. */
  suggestedAmount?: number;
  /** An existing receipt being corrected. */
  record?: { amount: number; vat: number; tds: number };
  /** True when the money arrives in the VAT account; turns VAT on by default. */
  vatSuggested: boolean;
  /** True when this client normally deducts TDS; pre-selects 1.5%. */
  tdsSuggested?: boolean;
  /** e.g. "NPR 15,000 still owed on this setup charge" */
  remainingHint?: string;
  onAmountChange?: (amount: number) => void;
}) {
  const editing = record != null;
  const startAmount = record?.amount ?? suggestedAmount ?? 0;
  const [entry, setEntry] = useState<"bill" | "bank">("bill");
  const [bill, setBill] = useState(startAmount > 0 ? String(startAmount) : "");
  const [bank, setBank] = useState("");
  const [withVat, setWithVat] = useState(editing ? record.vat > 0 : vatSuggested);
  const [vatText, setVatText] = useState(editing && record.vat > 0 ? String(record.vat) : "");
  const [vatEdited, setVatEdited] = useState(
    editing && record.vat > 0 && record.vat !== vatOn(record.amount)
  );
  const initialTds = record?.tds ?? 0;
  const [tdsMode, setTdsMode] = useState<TdsMode>(
    !editing
      ? tdsSuggested ? "auto" : "none"
      : initialTds <= 0 ? "none" : initialTds === tdsOn(startAmount) ? "auto" : "custom"
  );
  const [tdsText, setTdsText] = useState(initialTds > 0 ? String(initialTds) : "");

  // Follow the receiving account until the person decides for themselves.
  const [vatTouched, setVatTouched] = useState(editing);
  useEffect(() => {
    if (!vatTouched) setWithVat(vatSuggested);
  }, [vatSuggested, vatTouched]);

  let billAmount = Number(bill || 0);
  if (entry === "bank") {
    const total = Number(bank || 0);
    if (tdsMode === "custom") {
      billAmount = round2((total + Number(tdsText || 0)) / (1 + (withVat ? VAT_RATE : 0)));
    } else {
      billAmount = total > 0 ? billFromBankTotal(total, withVat, tdsMode === "auto") : 0;
    }
  }
  const vat = withVat ? (vatEdited && entry === "bill" ? Number(vatText || 0) : vatOn(billAmount)) : 0;
  const tds =
    tdsMode === "auto" ? tdsOn(billAmount) : tdsMode === "custom" ? Number(tdsText || 0) : 0;
  const reachedBank = round2(billAmount + vat - tds);

  useEffect(() => {
    onAmountChange?.(billAmount);
  }, [billAmount, onAmountChange]);

  return (
    <div className="space-y-3">
      <input type="hidden" name={amountName} value={billAmount > 0 ? billAmount : ""} />
      <input type="hidden" name={vatName} value={vat} />
      <input type="hidden" name={tdsName} value={tds} />

      <div className="segmented" role="tablist" aria-label="Which amount do you know">
        <button
          type="button"
          className={entry === "bill" ? "segmented-on" : ""}
          onClick={() => {
            if (entry === "bank" && billAmount > 0) setBill(String(billAmount));
            setEntry("bill");
          }}
        >
          I know our price (excl. VAT)
        </button>
        <button
          type="button"
          className={entry === "bank" ? "segmented-on" : ""}
          onClick={() => {
            if (entry === "bill" && reachedBank > 0) setBank(String(reachedBank));
            setEntry("bank");
          }}
        >
          I know what reached the bank
        </button>
      </div>

      {entry === "bill" ? (
        <label className="block">
          <span className="field-label">Our price · excluding VAT ({currency})</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={bill}
            onChange={(event) => setBill(event.target.value)}
            placeholder="e.g. 35000"
            className="input tnum mt-1"
          />
          {remainingHint && <p className="field-help">{remainingHint}</p>}
        </label>
      ) : (
        <label className="block">
          <span className="field-label">Amount that reached the bank ({currency})</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={bank}
            onChange={(event) => setBank(event.target.value)}
            placeholder="e.g. 39550"
            className="input tnum mt-1"
          />
          <p className="field-help">The bill amount, VAT and TDS are worked out from this.</p>
        </label>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={withVat}
              onChange={(event) => {
                setVatTouched(true);
                setWithVat(event.target.checked);
              }}
            />
            <span>
              <strong>VAT bill · 13% on top</strong>
              <small>Kept aside for IRD. Never counted as income.</small>
            </span>
          </label>
          {withVat && entry === "bill" && (
            <label className="block">
              <span className="field-label">VAT amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={vatEdited ? vatText : vatOn(billAmount) || ""}
                onChange={(event) => {
                  setVatEdited(true);
                  setVatText(event.target.value);
                }}
                className="input tnum mt-1"
              />
            </label>
          )}
        </div>

        <div className="space-y-2">
          <span className="field-label">TDS withheld by the client</span>
          <div className="segmented segmented-3">
            {(
              [
                ["none", "None"],
                ["auto", `${TDS_RATE * 100}%`],
                ["custom", "Other"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={tdsMode === mode ? "segmented-on" : ""}
                onClick={() => setTdsMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {tdsMode === "custom" && (
            <input
              type="number"
              min="0"
              step="0.01"
              value={tdsText}
              onChange={(event) => setTdsText(event.target.value)}
              placeholder="TDS amount"
              className="input tnum"
            />
          )}
          <p className="field-help">
            TDS is {TDS_RATE * 100}% of the bill amount <strong>excluding VAT</strong>. Pick it only if the
            client actually deducted it — it becomes a tax credit, not lost money.
          </p>
        </div>
      </div>

      <dl className="money-breakdown">
        <div>
          <dt>Our price · our income (excl. VAT)</dt>
          <dd>{formatIncomeMoney(billAmount, currency)}</dd>
        </div>
        <div>
          <dt>+ VAT {VAT_RATE * 100}% · IRD&apos;s money, don&apos;t touch</dt>
          <dd>{formatIncomeMoney(vat, currency)}</dd>
        </div>
        <div>
          <dt>= Invoice to client</dt>
          <dd>{formatIncomeMoney(round2(billAmount + vat), currency)}</dd>
        </div>
        <div>
          <dt>
            − TDS {tdsMode === "auto" ? `${TDS_RATE * 100}% of ${formatIncomeMoney(billAmount, currency)} (before VAT)` : "withheld by client"}
          </dt>
          <dd>{formatIncomeMoney(tds, currency)}</dd>
        </div>
        <div className="money-breakdown-total">
          <dt>= Reaches the bank</dt>
          <dd>{formatIncomeMoney(reachedBank, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}
