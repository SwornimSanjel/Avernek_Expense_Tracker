"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { countBillAsExpense, setBillCategory, unlinkBillExpense } from "@/app/(app)/bills/actions";
import Icon from "./Icons";
import { billTypeLabel, sortBillCategories, type BillCategory } from "@/lib/bill-types";
import { formatNumber } from "@/lib/format";
import { formatServiceDate } from "@/lib/income";

type Account = { id: string; name: string; kind: string };
type Person = { id: string; name: string };
export type ExpenseMatch = { id: string; date: string; amount: number; label: string };

function accountLabel(account: Account) {
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

/** The bill's type, changeable in place. */
export function BillTypePicker({
  billId,
  categoryId,
  categories,
  canManage,
}: {
  billId: string;
  categoryId: string | null;
  categories: BillCategory[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = categories.find((category) => category.id === categoryId);
  if (!canManage) {
    return (
      <span className="bill-type">
        <span className="bill-type-dot" style={{ background: current?.color ?? "var(--muted-2)" }} />
        {billTypeLabel(current?.name)}
      </span>
    );
  }
  return (
    <label className="bill-type bill-type-edit" title="Change the type">
      <span className="bill-type-dot" style={{ background: current?.color ?? "var(--muted-2)" }} />
      <select
        value={categoryId ?? ""}
        disabled={pending}
        aria-label="Bill type"
        onChange={(event) =>
          start(async () => {
            await setBillCategory(billId, event.target.value || null);
            router.refresh();
          })
        }
      >
        <option value="">No type yet</option>
        {sortBillCategories(categories).map((category) => (
          <option key={category.id} value={category.id}>
            {billTypeLabel(category.name)}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} />
    </label>
  );
}

/**
 * Is this bill counted in Expenses? Linked → "In expenses". Not linked → the
 * dialog says plainly what each choice does to the money:
 *
 *   Link the expense already typed in      → nothing new, no balance changes
 *   Already counted another way            → nothing new, no balance changes
 *   New expense from a company account     → that account's balance goes down
 *   New expense with a partner's own money → no company balance changes
 */
export function BillExpenseStatus({
  billId,
  linked,
  elsewhere,
  counts,
  total,
  matches,
  accounts,
  people,
  canManage,
}: {
  billId: string;
  /** The linked expense, described. */
  linked: string | null;
  /** Marked as already covered by an expense that is not linked. */
  elsewhere: boolean;
  /** False for types that are not a company expense (drinks, smoke). */
  counts: boolean;
  /** The bill total in NPR, for the "takes NPR … off" sentence. */
  total: number;
  matches: ExpenseMatch[];
  accounts: Account[];
  people: Person[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function undo(message: string) {
    if (!window.confirm(message)) return;
    start(async () => {
      await unlinkBillExpense(billId);
      router.refresh();
    });
  }

  if (linked || elsewhere) {
    return (
      <span className="bill-status bill-status-ok" title={linked ?? "Covered by an expense already in Expenses"}>
        <Icon name="check" size={13} /> {linked ? "In expenses" : "Counted elsewhere"}
        {canManage && (
          <button
            type="button"
            className="bill-status-undo"
            disabled={pending}
            onClick={() =>
              undo(linked ? "Unlink this bill from its expense? The expense itself stays." : "Mark this bill as not counted yet?")
            }
          >
            {linked ? "Unlink" : "Undo"}
          </button>
        )}
      </span>
    );
  }
  if (!counts) {
    return <span className="bill-status">Not a company expense</span>;
  }
  if (!canManage) return <span className="bill-status bill-status-warn">Not linked to an expense</span>;

  function run(choice: Parameters<typeof countBillAsExpense>[1]) {
    setError(null);
    start(async () => {
      const result = await countBillAsExpense(billId, choice);
      if (result.error) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  const account = paid.startsWith("acct:") ? accounts.find((item) => `acct:${item.id}` === paid) : null;
  const person = paid.startsWith("person:") ? people.find((item) => `person:${item.id}` === paid) : null;

  return (
    <>
      <button type="button" className="bill-status bill-status-warn bill-status-action" onClick={() => setOpen(true)}>
        <Icon name="alert" size={13} /> Link to its expense
      </button>
      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Is this bill in Expenses?</h2>
                <p className="text-[13.5px] muted mt-1">Pick what really happened — so this NPR {formatNumber(total)} is counted exactly once.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn" aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-[14px] font-semibold">Yes — I already typed it in</div>
              {matches.length > 0 ? (
                matches.map((match) => (
                  <button key={match.id} type="button" disabled={pending} onClick={() => run({ link: match.id })} className="bill-match">
                    <span className="min-w-0 flex-1 truncate">
                      {match.label}
                      <span className="muted"> · {formatServiceDate(match.date)}</span>
                    </span>
                    <strong className="tnum">NPR {formatNumber(match.amount)}</strong>
                    <span className="text-[13px] text-accent">Link</span>
                  </button>
                ))
              ) : (
                <p className="text-[13px] muted">No expense with this amount within 10 days of the bill.</p>
              )}
              <button type="button" disabled={pending} onClick={() => run({ elsewhere: true })} className="bill-match">
                <span className="min-w-0 flex-1">
                  It&apos;s inside another expense
                  <span className="block text-[12.5px] muted">e.g. one combined food entry. Marks it counted; no money changes.</span>
                </span>
                <span className="text-[13px] text-accent">Mark</span>
              </button>
            </div>

            <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <div className="text-[14px] font-semibold">No — add it to Expenses now</div>
              <select className="input" value={paid} onChange={(event) => setPaid(event.target.value)}>
                <option value="">Who paid?</option>
                <optgroup label="Company money">
                  {accounts.map((item) => (
                    <option key={item.id} value={`acct:${item.id}`}>
                      {accountLabel(item)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Own money (partner)">
                  {people.map((item) => (
                    <option key={item.id} value={`person:${item.id}`}>
                      {item.name}&apos;s own money
                    </option>
                  ))}
                </optgroup>
              </select>
              {account && (
                <p className="text-[12.5px] text-amber leading-snug">
                  Takes NPR {formatNumber(total)} off the {accountLabel(account)} balance. Choose this only if the money really left that account and is not in Expenses yet.
                </p>
              )}
              {person && (
                <p className="text-[12.5px] muted leading-snug">
                  Counted as {person.name}&apos;s own money put into the company. No company account balance changes.
                </p>
              )}
              <button
                type="button"
                disabled={pending || !paid}
                className="btn btn-primary w-full !h-11"
                onClick={() =>
                  run({
                    paid: paid.startsWith("acct:")
                      ? { by: "account", accountId: paid.slice(5) }
                      : { by: "person", userId: paid.slice(7) },
                  })
                }
              >
                {pending ? "Saving…" : "Add to expenses"}
              </button>
            </div>
            {error && <p className="text-sm text-red">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
