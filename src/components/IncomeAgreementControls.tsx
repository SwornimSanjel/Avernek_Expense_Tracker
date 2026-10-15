"use client";

import { guardRequest } from "@/lib/stale-deploy";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteIncomeAgreement,
  setIncomeAgreementStatus,
  updateIncomeAgreement,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import type { IncomeAgreement, IncomePayment, MoneyAccount } from "@/lib/types";
import { vatBillPaymentRows } from "@/lib/income";
import IncomeAgreementFields, { AGREEMENT_TABS, type AgreementSection } from "./IncomeAgreementFields";
import type { Attachment } from "@/lib/attachments";
import Icon from "./Icons";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Edit / pause / delete for one client. Every meaningful field stays editable
 * here — dates included — because a contract that changed in real life must be
 * correctable without recreating the client and losing its payment history.
 */
export default function IncomeAgreementControls({
  agreement,
  moneyAccounts,
  paymentCount,
  recurringPaymentCount = 0,
  agreementFiles = [],
  payments = [],
  vatBills = [],
  redirectOnDelete,
  showEditButton,
}: {
  agreement: IncomeAgreement;
  moneyAccounts: MoneyAccount[];
  paymentCount: number;
  recurringPaymentCount?: number;
  /** Signed agreement pages already on file. */
  agreementFiles?: Attachment[];
  /** This client's payments, for the VAT bills tab. */
  payments?: IncomePayment[];
  /** VAT bills already saved on those payments. */
  vatBills?: Attachment[];
  redirectOnDelete?: string;
  /** Show a visible “Edit client” button next to the ⋯ menu. */
  showEditButton?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<AgreementSection>("client");
  const vatPayments = vatBillPaymentRows(
    payments.filter((payment) => payment.agreement_id === agreement.id),
    agreement.currency
  );
  const vatBillsByPayment: Record<string, Attachment[]> = {};
  for (const bill of vatBills) {
    if (bill.payment_id) (vatBillsByPayment[bill.payment_id] ??= []).push(bill);
  }
  const tabCount: Partial<Record<AgreementSection, number>> = {
    agreement: agreementFiles.length,
    vatbills: vatPayments.reduce((sum, row) => sum + (vatBillsByPayment[row.id]?.length ?? 0), 0),
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [state, action, pending] = useActionState(guardRequest(updateIncomeAgreement), initialState);
  const [statusPending, startTransition] = useTransition();
  const wrapper = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <>
      {showEditButton && (
        <button type="button" onClick={() => setEditing(true)} className="btn">
          <Icon name="edit" size={15} /> Edit client
        </button>
      )}
      <div className="relative" ref={wrapper}>
        <button
          disabled={statusPending}
          onClick={() => setMenuOpen((value) => !value)}
          className="icon-btn !w-9 !h-9"
          aria-label="Client actions"
        >
          <Icon name="more" size={17} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 z-20 w-52 card !rounded-xl p-1 text-[13px] shadow-xl">
            <button
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
              onClick={() => {
                setMenuOpen(false);
                setEditing(true);
              }}
            >
              Edit client &amp; services
            </button>
            {agreement.status === "active" ? (
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
                onClick={() =>
                  startTransition(async () => {
                    await setIncomeAgreementStatus(agreement.id, "paused");
                    setMenuOpen(false);
                  })
                }
              >
                Pause services
              </button>
            ) : (
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
                onClick={() =>
                  startTransition(async () => {
                    await setIncomeAgreementStatus(agreement.id, "active");
                    setMenuOpen(false);
                  })
                }
              >
                Set back to active
              </button>
            )}
            {agreement.status !== "completed" && (
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
                onClick={() => {
                  if (!window.confirm("Mark this client completed and stop future recurring dues? All history is kept."))
                    return;
                  startTransition(async () => {
                    await setIncomeAgreementStatus(agreement.id, "completed");
                    setMenuOpen(false);
                  });
                }}
              >
                Complete service
              </button>
            )}
            <div className="my-1 border-t" style={{ borderColor: "var(--line)" }} />
            <button
              className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/[.04]"
              style={{ color: "var(--red)" }}
              onClick={() => {
                const paymentWarning = paymentCount > 0
                  ? ` and its ${paymentCount} payment record${paymentCount === 1 ? "" : "s"}`
                  : "";
                if (
                  !window.confirm(
                    `Delete ${agreement.client_name}${paymentWarning}? This removes its receipts from the account balance and cannot be undone.`
                  )
                )
                  return;
                startTransition(async () => {
                  try {
                    await deleteIncomeAgreement(agreement.id);
                    setMenuOpen(false);
                    if (redirectOnDelete) router.push(redirectOnDelete);
                  } catch (error) {
                    window.alert(
                      error instanceof Error ? error.message : "Could not delete this client."
                    );
                  }
                });
              }}
            >
              Delete client &amp; agreement
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop">
          <form action={action} className="modal-panel modal-panel-sheet md:max-w-3xl">
            <input type="hidden" name="agreement_id" value={agreement.id} />
            <div className="modal-sheet-head">
              <div className="modal-header">
                <div>
                  <h2 className="text-lg font-bold">Edit {agreement.client_name}</h2>
                  <p className="text-[13px] muted">
                    Recorded payments are kept — balances recalculate from them.
                  </p>
                </div>
                <button type="button" onClick={() => setEditing(false)} className="icon-btn" aria-label="Close"><Icon name="close" size={16} /></button>
              </div>
              <nav className="sheet-tabs" role="tablist">
                {AGREEMENT_TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.key}
                    onClick={() => setTab(item.key)}
                    className={`sheet-tab ${tab === item.key ? "sheet-tab-on" : ""}`}
                  >
                    {item.title}
                    {(tabCount[item.key] ?? 0) > 0 && (
                      <span className="sheet-tab-count">{tabCount[item.key]}</span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            <div className="modal-sheet-body">
              <IncomeAgreementFields
                agreement={agreement}
                moneyAccounts={moneyAccounts}
                recurringPaymentCount={recurringPaymentCount}
                agreementFiles={agreementFiles}
                onFilesBusyChange={setFilesBusy}
                activeSection={tab}
                vatPayments={vatPayments}
                vatBillsByPayment={vatBillsByPayment}
              />
            </div>

            <div className="modal-sheet-foot">
              {state.error ? (
                <p className="text-sm min-w-0 flex-1" style={{ color: "var(--red)" }}>{state.error}</p>
              ) : (
                <p className="text-[13px] muted min-w-0 flex-1">Changes on every tab are saved together.</p>
              )}
              <button type="button" onClick={() => setEditing(false)} className="btn !h-11">
                Cancel
              </button>
              <button disabled={pending || filesBusy} className="btn btn-primary !h-11 !px-6">
                {pending ? "Saving…" : filesBusy ? "Preparing photos…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
