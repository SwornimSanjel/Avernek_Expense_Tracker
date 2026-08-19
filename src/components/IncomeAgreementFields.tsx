"use client";

import { useMemo, useState } from "react";
import type {
  Currency,
  IncomeAgreement,
  MoneyAccount,
  SetupPaymentTerms,
} from "@/lib/types";
import { addCalendarDays } from "@/lib/income";

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

export default function IncomeAgreementFields({
  agreement,
  includeInitialPayment = false,
  moneyAccounts = [],
}: {
  agreement?: IncomeAgreement;
  includeInitialPayment?: boolean;
  moneyAccounts?: MoneyAccount[];
}) {
  const [terms, setTerms] = useState<SetupPaymentTerms>(
    agreement?.setup_payment_terms ?? "custom"
  );
  const [setupAmount, setSetupAmount] = useState(
    agreement ? String(Number(agreement.setup_amount)) : ""
  );
  const [initialPaid, setInitialPaid] = useState("");
  const [initialPaidOn, setInitialPaidOn] = useState(today());
  const [currency, setCurrency] = useState<Currency>(agreement?.currency ?? "NPR");
  const dueAmount = useMemo(
    () => Math.max(0, Number(setupAmount || 0) - Number(initialPaid || 0)),
    [setupAmount, initialPaid]
  );
  const hasOpeningPayment = includeInitialPayment && Number(initialPaid) > 0;
  const matchingAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === currency
  );

  return (
    <div className="space-y-4">
      <FormSection
        number="01"
        title="Client & service"
        description="The agreement and the exact day service begins."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Client name">
            <input
              name="client_name"
              required
              autoFocus={!agreement}
              defaultValue={agreement?.client_name ?? ""}
              placeholder="e.g. Hotel Everest"
              className="input"
            />
          </Field>
          <Field label="Service">
            <select
              name="service_type"
              defaultValue={agreement?.service_type ?? "full_track"}
              className="input"
            >
              <option value="ai_automation">AI automation only</option>
              <option value="marketing">Marketing only</option>
              <option value="full_track">Full track · AI + marketing</option>
            </select>
          </Field>
          <Field label="Agreement signed date">
            <input
              name="agreement_date"
              type="date"
              required
              defaultValue={agreement?.agreement_date ?? today()}
              className="input"
            />
          </Field>
          <Field label="Ads / automation live date · Service Day 1">
            <input
              name="ads_live_date"
              type="date"
              required
              defaultValue={agreement?.ads_live_date ?? today()}
              className="input"
            />
            <p className="field-help">This is when delivery goes live. Recurring billing is timed separately from the first setup payment date.</p>
          </Field>
        </div>
      </FormSection>

      <FormSection
        number="02"
        title="Agreement value"
        description="What the client owes for the first cycle and every cycle after."
      >
        <div className="grid sm:grid-cols-[1fr_1fr_120px] gap-3">
          <Field label="First 30 days / setup">
            <input
              name="setup_amount"
              type="number"
              step="0.01"
              required
              min="0"
              value={setupAmount}
              onChange={(event) => setSetupAmount(event.target.value)}
              placeholder="50000"
              className="input tnum"
            />
          </Field>
          <Field label="Recurring every 30 days">
            <input
              name="recurring_amount"
              type="number"
              step="0.01"
              required
              min="0"
              defaultValue={agreement ? Number(agreement.recurring_amount) : ""}
              placeholder="40000"
              className="input tnum"
            />
          </Field>
          <Field label="Currency">
            <select
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
              className="input"
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
        </div>
      </FormSection>

      {includeInitialPayment && (
        <FormSection
          number="03"
          title="Opening payment"
          description="Record the payment already received, or leave it at zero."
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Paid amount">
              <input
                name="initial_paid_amount"
                type="number"
                min="0"
                max={Number(setupAmount || 0)}
                step="0.01"
                value={initialPaid}
                onChange={(event) => setInitialPaid(event.target.value)}
                placeholder="0"
                className="input tnum"
              />
            </Field>
            <div className="agreement-balance-preview">
              <span>Due amount after this payment</span>
              <strong className="tnum">{dueAmount.toLocaleString("en-NP")}</strong>
            </div>
          </div>

          {hasOpeningPayment && (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <Field label="Paid date">
                <input
                  name="initial_paid_on"
                  type="date"
                  required
                  value={initialPaidOn}
                  onChange={(event) => setInitialPaidOn(event.target.value)}
                  className="input"
                />
              </Field>
              <Field label={`Client paid into (${currency})`}>
                <select name="initial_money_account_id" required defaultValue="" className="input">
                  <option value="" disabled>Choose receiving account</option>
                  {matchingAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </Field>
              <p className="sm:col-span-2 text-xs muted">
                Both choices hold Avernek&apos;s money. Swornim Global IME is for non-VAT receipts; the company Global IME account is for VAT-bill receipts.
              </p>
              <div className="sm:col-span-2 agreement-balance-preview">
                <span>First recurring payment date · 30 days after this payment</span>
                <strong className="tnum">{addCalendarDays(initialPaidOn, 30)}</strong>
              </div>
            </div>
          )}
        </FormSection>
      )}

      <details className="agreement-details">
        <summary>
          <span>
            <strong>Optional agreement details</strong>
            <small>Contact, payment terms, due timing, and notes</small>
          </span>
        </summary>
        <div className="p-4 space-y-3 border-t" style={{ borderColor: "var(--line)" }}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Custom agreement title (optional)">
              <input
                name="agreement_name"
                defaultValue={agreement?.agreement_name ?? ""}
                placeholder="e.g. Growth partnership"
                className="input"
              />
            </Field>
            <Field label="Contact person (optional)">
              <input
                name="contact_name"
                defaultValue={agreement?.contact_name ?? ""}
                placeholder="Client contact"
                className="input"
              />
            </Field>
            <Field label="Setup payment arrangement">
              <select
                name="setup_payment_terms"
                value={terms}
                onChange={(event) => setTerms(event.target.value as SetupPaymentTerms)}
                className="input"
              >
                <option value="full_upfront">Full setup upfront</option>
                <option value="half_advance">Advance + rest on ads / automation-live day</option>
                <option value="custom">Custom / partial payments</option>
              </select>
            </Field>
            <Field label="Setup balance due date">
              <input
                name="setup_due_date"
                type="date"
                required
                defaultValue={agreement?.setup_due_date ?? today()}
                className="input"
              />
            </Field>
            {terms === "half_advance" ? (
              <Field label="Advance percentage">
                <input
                  name="setup_advance_percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={agreement ? Number(agreement.setup_advance_percent) : 50}
                  className="input tnum"
                />
              </Field>
            ) : (
              <input type="hidden" name="setup_advance_percent" value="100" />
            )}
            <Field label="Recurring payment due">
              <div className="flex items-center gap-2">
                <input
                  name="recurring_due_days_before"
                  type="number"
                  min="0"
                  max="30"
                  defaultValue={agreement?.recurring_due_days_before ?? 0}
                  className="input tnum !w-20"
                />
                <span className="text-xs muted">days before each next 30-day cycle</span>
              </div>
            </Field>
          </div>
          <Field label="Agreement notes (optional)">
            <textarea
              name="notes"
              defaultValue={agreement?.notes ?? ""}
              placeholder="Scope, special payment conditions, invoice details…"
              className="input !h-24 py-3 resize-none"
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="agreement-form-section">
      <div className="agreement-form-heading">
        <span>{number}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
