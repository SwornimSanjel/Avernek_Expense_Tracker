"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeReceiptCopy, settleOldBills } from "@/app/(app)/bills/actions";
import Icon from "./Icons";
import { formatServiceDate } from "@/lib/income";
import type { ReceiptCopy } from "@/lib/bill-duplicates";

/**
 * Receipts that created a second expense for spending typed in before. One
 * press keeps the typed expense, moves the receipt onto it and removes the
 * copy, so the account balance is back to what it was.
 */
export function ReceiptCopyFixer({ copies }: { copies: ReceiptCopy[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fix(list: ReceiptCopy[]) {
    setError(null);
    start(async () => {
      for (const copy of list) {
        const result = await mergeReceiptCopy(copy.copyId, copy.keepId);
        if (result.error) {
          setError(result.error);
          break;
        }
      }
      router.refresh();
    });
  }

  if (!copies.length) return null;
  return (
    <div className="copy-fixer rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-amber">
            <Icon name="alert" size={16} />
            {copies.length === 1 ? "1 receipt was counted twice" : `${copies.length} receipts were counted twice`}
          </div>
          <p className="text-[13.5px] muted mt-1">
            You had already typed these into Expenses, so uploading the receipt took the money off a second time. Fixing keeps your typed expense, attaches the receipt to it and removes the copy.
          </p>
        </div>
        {copies.length > 1 && (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => fix(copies)}>
            {pending ? "Fixing…" : `Fix all ${copies.length}`}
          </button>
        )}
      </div>
      <div className="space-y-2 mt-3">
        {copies.map((copy) => (
          <div key={copy.copyId} className="copy-row">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold truncate">{copy.label}</div>
              <div className="text-[13px] muted mt-0.5">
                Typed by you: {copy.keepText} on {formatServiceDate(copy.keepDate)}
                {copy.keepNote ? ` · “${copy.keepNote.slice(0, 50)}”` : ""}
              </div>
              <div className="text-[13px] text-amber">Copy from the receipt: {copy.copyText} on {formatServiceDate(copy.copyDate)} — will be removed</div>
            </div>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => fix([copy])}>
              Fix
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red mt-2">{error}</p>}
    </div>
  );
}

/** Old bills, all already in Expenses: link or mark them all without moving money. */
export function SettleOldBillsButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  if (!count) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Are all ${count} of these old bills already in Expenses?\n\nEach is linked to the expense that matches it (same amount, within 10 days); the rest are marked “counted elsewhere”. No expense is added and no balance changes.`
            )
          )
            return;
          start(async () => {
            const outcome = await settleOldBills();
            setResult(
              outcome.error
                ? outcome.error
                : `Done: ${outcome.linked} linked to their expense, ${outcome.marked} marked counted elsewhere. No money moved.`
            );
            router.refresh();
          });
        }}
      >
        <Icon name="check" size={14} /> {pending ? "Settling…" : `These are old bills — all already in Expenses`}
      </button>
      {result && <span className="text-[13px] text-green">{result}</span>}
    </span>
  );
}
