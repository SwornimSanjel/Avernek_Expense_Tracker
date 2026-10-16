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
 * Is this bill counted in Expenses? Linked → "In expenses". Not linked → one
 * press records it (or links the expense already typed in, when one matches),
 * so the same spending is never counted twice.
 */
export function BillExpenseStatus({
  billId,
  linked,
  counts,
  matches,
  accounts,
  people,
  canManage,
}: {
  billId: string;
  /** The linked expense, described. */
  linked: string | null;
  /** False for types that are not a company expense (drinks, smoke). */
  counts: boolean;
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

  if (linked) {
    return (
      <span className="bill-status bill-status-ok" title={linked}>
        <Icon name="check" size={13} /> In expenses
        {canManage && (
          <button
            type="button"
            className="bill-status-undo"
            disabled={pending}
            onClick={() =>
              window.confirm("Unlink this bill from its expense? The expense itself stays.") &&
              start(async () => {
                await unlinkBillExpense(billId);
                router.refresh();
              })
            }
          >
            Unlink
          </button>
        )}
      </span>
    );
  }
  if (!counts) {
    return <span className="bill-status">Not a company expense</span>;
  }
  if (!canManage) return <span className="bill-status bill-status-warn">Not in expenses yet</span>;

  function run(choice: Parameters<typeof countBillAsExpense>[1]) {
    setError(null);
    start(async () => {
      const result = await countBillAsExpense(billId, choice);
      if (result.error) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="bill-status bill-status-warn bill-status-action" onClick={() => setOpen(true)}>
        <Icon name="alert" size={13} /> Count as expense
      </button>
      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel md:max-w-md p-5 md:p-6 space-y-4">
            <div className="modal-header">
              <div>
                <h2 className="text-lg font-bold">Count this bill as an expense</h2>
                <p className="text-[13.5px] muted mt-1">So it shows in Expenses and the account balance — once.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="icon-btn" aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>

            {matches.length > 0 && (
              <div className="space-y-2">
                <div className="text-[13.5px] font-semibold">Already typed into Expenses? Link it instead:</div>
                {matches.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    disabled={pending}
                    onClick={() => run({ link: match.id })}
                    className="bill-match"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {match.label}
                      <span className="muted"> · {formatServiceDate(match.date)}</span>
                    </span>
                    <strong className="tnum">NPR {formatNumber(match.amount)}</strong>
                    <span className="text-[13px] text-accent">Link</span>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="text-[13.5px] font-semibold">{matches.length ? "Or record it as a new expense:" : "Record it as an expense:"}</div>
              <select className="input" value={paid} onChange={(event) => setPaid(event.target.value)}>
                <option value="">Who paid?</option>
                <optgroup label="Company money">
                  {accounts.map((account) => (
                    <option key={account.id} value={`acct:${account.id}`}>
                      {accountLabel(account)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Own money (partner)">
                  {people.map((person) => (
                    <option key={person.id} value={`person:${person.id}`}>
                      {person.name}&apos;s own money
                    </option>
                  ))}
                </optgroup>
              </select>
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
