"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addIncomeAgreement,
  type IncomeFormState,
} from "@/app/(app)/income/actions";
import IncomeAgreementFields, { AGREEMENT_STEPS } from "./IncomeAgreementFields";
import type { MoneyAccount } from "@/lib/types";

const initialState: IncomeFormState = { error: null, ok: null };

/**
 * Adding a client stays a five-step walk even though the model underneath is
 * detailed: client → pricing → payment → service status → review. Every step is
 * part of the same form, so nothing is lost moving back and forth, and only the
 * first step really has to be filled in.
 */
export default function AddIncomeAgreement({
  moneyAccounts,
  label = "Add client",
}: {
  moneyAccounts: MoneyAccount[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [hint, setHint] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState(addIncomeAgreement, initialState);

  useEffect(() => {
    if (!state.ok) return;
    setOpen(false);
    setStep(1);
    // Open the client that was just created rather than making the user find it.
    if (state.agreementId) router.push(`/income/${state.agreementId}`);
  }, [state.ok, state.agreementId, router]);

  function next() {
    const form = formRef.current;
    if (step === 1 && form) {
      const name = (form.elements.namedItem("client_name") as HTMLInputElement | null)?.value.trim();
      const services = ["has_website", "has_ads", "has_automation"].some(
        (field) => (form.elements.namedItem(field) as HTMLInputElement | null)?.checked
      );
      if (!name) return setHint("Enter the client name to continue.");
      if (!services) return setHint("Select at least one service to continue.");
    }
    setHint(null);
    setStep((value) => Math.min(AGREEMENT_STEPS.length, value + 1));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <span className="text-base leading-none">＋</span> {label}
      </button>
    );
  }

  const isLast = step === AGREEMENT_STEPS.length;

  return (
    <div className="modal-backdrop">
      <form ref={formRef} action={action} className="modal-panel md:max-w-3xl p-5 md:p-6 space-y-4">
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-bold">New client</h2>
            <p className="text-xs muted">
              Only the client name and one service are needed. Prices, live dates and payments can all be added later.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="icon-btn">
            ✕
          </button>
        </div>

        <ol className="wizard-steps">
          {AGREEMENT_STEPS.map((item) => (
            <li
              key={item.step}
              className={`wizard-step ${item.step === step ? "wizard-step-active" : ""} ${
                item.step < step ? "wizard-step-done" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setHint(null);
                  setStep(item.step);
                }}
              >
                <span className="wizard-step-index">{item.step}</span>
                <span className="wizard-step-text">
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <IncomeAgreementFields
          includeInitialPayment
          moneyAccounts={moneyAccounts}
          activeStep={step}
        />

        {hint && <p className="text-sm" style={{ color: "var(--amber)" }}>{hint}</p>}
        {state.error && <p className="text-sm" style={{ color: "var(--red)" }}>{state.error}</p>}

        <div className="flex items-center gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((value) => Math.max(1, value - 1))}
              className="btn !h-12"
            >
              Back
            </button>
          )}
          {!isLast ? (
            <button type="button" onClick={next} className="btn btn-primary flex-1 !h-12">
              Continue
            </button>
          ) : (
            <button disabled={pending} className="btn btn-primary flex-1 !h-12">
              {pending ? "Saving…" : "Save client"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
