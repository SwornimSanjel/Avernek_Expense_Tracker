"use client";

import { useState } from "react";
import type {
  Currency,
  IncomeAgreement,
  IncomeAgreementStatus,
  MoneyAccount,
  WebsiteStatus,
} from "@/lib/types";
import {
  AGREEMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  WEBSITE_STATUS_LABELS,
  addCalendarDays,
  addCalendarMonths,
  formatIncomeMoney,
  formatServiceDate,
  goLiveDate,
  isValidDate,
  todayIso,
} from "@/lib/income";
import { accountShortName } from "@/lib/funds";
import TaxBreakdownFields from "./TaxBreakdownFields";

/**
 * Every editable field of one client, asking only for dates that exist in real
 * life:
 *
 *   Contract signed   the paper agreement
 *   Work started      optional
 *   Day 1             ads / AI automation launched → month 1 is the setup
 *                     charge, the monthly fee is billed from month 2
 *   Website           started / delivered — a one-off project, done once delivered
 *
 * Due dates, billing anchors and service statuses are worked out from those.
 * The add-client wizard passes `activeStep` (other steps stay mounted but
 * hidden so one form post carries everything); the edit modal shows all.
 */

export const AGREEMENT_STEPS = [
  { step: 1, title: "Client", hint: "Who and what they bought" },
  { step: 2, title: "Prices & dates", hint: "What was agreed and when" },
  { step: 3, title: "Money received", hint: "Optional — Rs. 0 is fine" },
] as const;

type Props = {
  agreement?: IncomeAgreement;
  moneyAccounts?: MoneyAccount[];
  /** Show the opening-payment step (new clients only). */
  includeInitialPayment?: boolean;
  /** Wizard mode: render only this step and keep the rest mounted but hidden. */
  activeStep?: number;
  /** Warn before moving Day 1 when monthly payments already depend on it. */
  recurringPaymentCount?: number;
};

export default function IncomeAgreementFields({
  agreement,
  moneyAccounts = [],
  includeInitialPayment = false,
  activeStep,
  recurringPaymentCount = 0,
}: Props) {
  const today = todayIso();
  const visible = (step: number) => activeStep == null || activeStep === step;

  const [clientName, setClientName] = useState(agreement?.client_name ?? "");
  const [hasWebsite, setHasWebsite] = useState(agreement?.has_website ?? false);
  const [hasAds, setHasAds] = useState(agreement?.has_ads ?? true);
  const [hasAutomation, setHasAutomation] = useState(agreement?.has_automation ?? true);
  const [currency, setCurrency] = useState<Currency>(agreement?.currency ?? "NPR");
  const [accountId, setAccountId] = useState(agreement?.default_money_account_id ?? "");

  const [signed, setSigned] = useState(agreement?.agreement_date ?? today);
  const [setupAmount, setSetupAmount] = useState(
    agreement && Number(agreement.setup_amount) > 0 ? String(Number(agreement.setup_amount)) : ""
  );
  const [monthlyAmount, setMonthlyAmount] = useState(
    agreement && Number(agreement.recurring_amount) > 0 ? String(Number(agreement.recurring_amount)) : ""
  );
  const originalDayOne = agreement ? goLiveDate(agreement) ?? "" : "";
  const [dayOne, setDayOne] = useState(originalDayOne);
  const [websiteAmount, setWebsiteAmount] = useState(
    agreement && Number(agreement.website_amount) > 0 ? String(Number(agreement.website_amount)) : ""
  );
  const [websiteDelivered, setWebsiteDelivered] = useState(agreement?.website_completed_date ?? "");

  const [initialFor, setInitialFor] = useState<"setup" | "website">("setup");
  const [initialAccountId, setInitialAccountId] = useState("");
  const [initialAmount, setInitialAmount] = useState(0);

  const monthly = hasAds || hasAutomation;
  const accounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === currency
  );
  const openingFor = monthly ? (hasWebsite ? initialFor : "setup") : "website";
  const openingAccountId = initialAccountId || accountId || accounts[0]?.id || "";
  const openingAccount = accounts.find((account) => account.id === openingAccountId);
  const dayOneMoved = Boolean(agreement) && monthly && dayOne !== originalDayOne;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ step 1 */}
      <FormSection
        number="1"
        title="Client"
        description="Who they are, what they bought, and which account they pay into."
        hidden={!visible(1)}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Client name">
            <input
              name="client_name"
              autoFocus={!agreement}
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="e.g. Hotel President"
              className="input"
            />
          </Field>
          <Field label="Contact person (optional)">
            <input
              name="contact_name"
              defaultValue={agreement?.contact_name ?? ""}
              placeholder="Who you deal with"
              className="input"
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="field-label">What did they buy?</span>
          <div className="service-picker-grid mt-2">
            <ServiceToggle
              name="has_ads"
              label="Ads / Marketing"
              hint="Monthly"
              checked={hasAds}
              onChange={setHasAds}
            />
            <ServiceToggle
              name="has_automation"
              label="AI Automation"
              hint="Monthly"
              checked={hasAutomation}
              onChange={setHasAutomation}
            />
            <ServiceToggle
              name="has_website"
              label="Website"
              hint="One-off project"
              checked={hasWebsite}
              onChange={setHasWebsite}
            />
          </div>
          {!hasWebsite && !monthly && (
            <p className="field-help" style={{ color: "var(--amber)" }}>
              Choose at least one. No agreement at all? Use “Add income (no client)” instead.
            </p>
          )}
        </div>

        <div className="mt-4">
          <span className="field-label">Which account do they usually pay into?</span>
          <div className="choice-grid mt-2">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => setAccountId(account.id)}
                className={`funding-choice ${accountId === account.id ? "funding-choice-active" : ""}`}
              >
                <strong>{accountShortName(account)}</strong>
                <span>
                  {account.kind === "company_bank"
                    ? "Avernek official · VAT bill (13%)"
                    : account.kind === "personal_custody"
                      ? "Swornim Global IME · no VAT"
                      : account.name}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAccountId("")}
              className={`funding-choice ${accountId === "" ? "funding-choice-active" : ""}`}
            >
              <strong>Decide each time</strong>
              <span>Choose on every payment</span>
            </button>
          </div>
          <input type="hidden" name="default_money_account_id" value={accountId} />
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Field label="Status">
            <select name="status" defaultValue={agreement?.status ?? "active"} className="input">
              {(Object.keys(AGREEMENT_STATUS_LABELS) as IncomeAgreementStatus[]).map((status) => (
                <option key={status} value={status}>
                  {AGREEMENT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Currency">
            <select
              name="currency"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value as Currency);
                setAccountId("");
              }}
              className="input"
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
        </div>
      </FormSection>

      {/* ------------------------------------------------------------ step 2 */}
      <FormSection
        number="2"
        title="Prices & dates"
        description="Only the dates that are on paper or really happened. Leave a date blank until it happens."
        hidden={!visible(2)}
      >
        <div className="service-block">
          <div className="service-block-title">Contract</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Contract signed on">
              <input
                name="agreement_date"
                type="date"
                value={signed}
                onChange={(event) => setSigned(event.target.value)}
                className="input"
              />
              <p className="field-help">The date on the paper agreement.</p>
            </Field>
            <Field label="Work started on (optional)">
              <input
                name="work_start_date"
                type="date"
                defaultValue={agreement?.work_start_date ?? ""}
                className="input"
              />
              <p className="field-help">When the team began preparing. Just for the record.</p>
            </Field>
          </div>
        </div>

        {monthly && (
          <div className="service-block mt-3">
            <div className="service-block-title">
              {hasAds && hasAutomation ? "Ads + AI automation" : hasAds ? "Ads / marketing" : "AI automation"} · monthly
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Setup charge · month 1">
                <input
                  name="setup_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={setupAmount}
                  onChange={(event) => setSetupAmount(event.target.value)}
                  placeholder="0"
                  className="input tnum"
                />
              </Field>
              <Field label="Monthly fee · month 2 onwards">
                <input
                  name="recurring_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={monthlyAmount}
                  onChange={(event) => setMonthlyAmount(event.target.value)}
                  placeholder="0"
                  className="input tnum"
                />
              </Field>
              <Field label="Day 1 · launched on">
                <input
                  name="go_live_date"
                  type="date"
                  value={dayOne}
                  onChange={(event) => setDayOne(event.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <p className="field-help">
              Amounts exclude VAT. Day 1 is the day ads / AI automation went live — leave it blank until launch
              and use “Launched” on the client later.
            </p>
            <BillingTimeline
              dayOne={dayOne}
              setup={Number(setupAmount || 0)}
              monthly={Number(monthlyAmount || 0)}
              currency={currency}
            />
            {dayOneMoved && recurringPaymentCount > 0 && (
              <label className="checkbox-row mt-3" style={{ borderColor: "var(--amber)" }}>
                <input type="checkbox" name="confirm_billing_change" />
                <span>
                  <strong>I understand the monthly due dates will move</strong>
                  <small>
                    {recurringPaymentCount} monthly payment{recurringPaymentCount === 1 ? " is" : "s are"} already
                    recorded against the old Day 1.
                  </small>
                </span>
              </label>
            )}
          </div>
        )}

        {hasWebsite && (
          <div className="service-block mt-3">
            <div className="service-block-title">Website · one-off project</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Website price">
                <input
                  name="website_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={websiteAmount}
                  onChange={(event) => setWebsiteAmount(event.target.value)}
                  placeholder="0"
                  className="input tnum"
                />
              </Field>
              <Field label="Progress">
                <select
                  name="website_status"
                  defaultValue={agreement?.website_status ?? "not_started"}
                  className="input"
                >
                  {(Object.keys(WEBSITE_STATUS_LABELS) as WebsiteStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {WEBSITE_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Started on (optional)">
                <input
                  name="website_start_date"
                  type="date"
                  defaultValue={agreement?.website_start_date ?? ""}
                  className="input"
                />
              </Field>
              <Field label="Delivered / launched on">
                <input
                  name="website_completed_date"
                  type="date"
                  value={websiteDelivered}
                  onChange={(event) => setWebsiteDelivered(event.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <p className="field-help">
              Once delivered the website is done; the remaining balance becomes due on that day.
            </p>
          </div>
        )}

        <details className="agreement-details mt-3">
          <summary>
            <span>
              <strong>More details (optional)</strong>
              <small>Contract end date, agreement title, notes</small>
            </span>
          </summary>
          <div className="p-4 space-y-3 border-t" style={{ borderColor: "var(--line)" }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Contract ends on">
                <input
                  name="contract_end_date"
                  type="date"
                  defaultValue={agreement?.contract_end_date ?? ""}
                  className="input"
                />
              </Field>
              <Field label="Agreement title">
                <input
                  name="agreement_name"
                  defaultValue={agreement?.agreement_name ?? ""}
                  placeholder="e.g. Growth partnership"
                  className="input"
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                name="notes"
                defaultValue={agreement?.notes ?? ""}
                placeholder="Scope, special conditions, invoice details…"
                className="input !h-20 py-3 resize-none"
              />
            </Field>
          </div>
        </details>
      </FormSection>

      {/* ------------------------------------------------------------ step 3 */}
      {includeInitialPayment && (
        <FormSection
          number="3"
          title="Money received so far"
          description="Leave the amount empty if nothing has been paid yet. Payments can be added any time."
          hidden={!visible(3)}
        >
          <input type="hidden" name="initial_payment_for" value={openingFor} />
          {monthly && hasWebsite && (
            <div className="choice-grid mb-3">
              {(["setup", "website"] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => setInitialFor(target)}
                  className={`funding-choice ${initialFor === target ? "funding-choice-active" : ""}`}
                >
                  <strong>{target === "setup" ? "Setup charge" : "Website"}</strong>
                  <span>
                    {formatIncomeMoney(
                      Number((target === "setup" ? setupAmount : websiteAmount) || 0),
                      currency
                    )}{" "}
                    agreed
                  </span>
                </button>
              ))}
            </div>
          )}

          <span className="field-label">Landed in</span>
          <div className="choice-grid mt-2 mb-3">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => setInitialAccountId(account.id)}
                className={`funding-choice ${openingAccountId === account.id ? "funding-choice-active" : ""}`}
              >
                <strong>{accountShortName(account)}</strong>
                <span>{account.name}</span>
              </button>
            ))}
          </div>
          <input type="hidden" name="initial_money_account_id" value={openingAccountId} />

          <TaxBreakdownFields
            currency={currency}
            amountName="initial_paid_amount"
            vatName="initial_vat_amount"
            tdsName="initial_tds_amount"
            vatSuggested={openingAccount?.kind === "company_bank"}
            onAmountChange={setInitialAmount}
          />

          {initialAmount > 0 && (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <Field label="Date received">
                <input name="initial_paid_on" type="date" defaultValue={today} className="input" />
              </Field>
              <Field label="Method (optional)">
                <select name="initial_method" defaultValue="bank_transfer" className="input">
                  <option value="">Not recorded</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <dl className="review-grid mt-4">
            <ReviewRow label="Client" value={clientName || "—"} />
            <ReviewRow
              label="Services"
              value={
                [hasAds && "Ads", hasAutomation && "AI automation", hasWebsite && "Website"]
                  .filter(Boolean)
                  .join(" + ") || "None selected"
              }
            />
            <ReviewRow label="Contract signed" value={formatServiceDate(signed)} />
            {monthly && (
              <ReviewRow
                label="Day 1"
                value={isValidDate(dayOne) ? formatServiceDate(dayOne) : "Not launched yet"}
              />
            )}
            {monthly && (
              <ReviewRow
                label="Setup · month 1"
                value={formatIncomeMoney(Number(setupAmount || 0), currency)}
              />
            )}
            {monthly && (
              <ReviewRow
                label="Monthly fee"
                value={`${formatIncomeMoney(Number(monthlyAmount || 0), currency)} / month`}
              />
            )}
            {hasWebsite && (
              <ReviewRow
                label="Website price"
                value={formatIncomeMoney(Number(websiteAmount || 0), currency)}
              />
            )}
            <ReviewRow
              label="Received now"
              value={initialAmount > 0 ? formatIncomeMoney(initialAmount, currency) + " (excl. VAT)" : "Nothing yet"}
            />
          </dl>
        </FormSection>
      )}
    </div>
  );
}

/** Day 1 → month 1 (setup) → month 2 (first monthly fee) → every month after. */
function BillingTimeline({
  dayOne,
  setup,
  monthly,
  currency,
}: {
  dayOne: string;
  setup: number;
  monthly: number;
  currency: Currency;
}) {
  if (!isValidDate(dayOne)) {
    return (
      <div className="timeline-preview mt-3">
        <span className="muted text-xs">
          Not launched yet. Setup is collected for month 1 and the monthly fee starts one month after Day 1.
        </span>
      </div>
    );
  }
  const monthTwo = addCalendarMonths(dayOne, 1);
  const monthThree = addCalendarMonths(dayOne, 2);
  const day = Number(dayOne.slice(8, 10));
  return (
    <ol className="timeline-preview mt-3">
      <li>
        <strong>Month 1 · setup</strong>
        <span>
          {formatServiceDate(dayOne)} – {formatServiceDate(addCalendarDays(monthTwo, -1))}
        </span>
        <em>{formatIncomeMoney(setup, currency)}</em>
      </li>
      <li>
        <strong>Month 2 · first monthly fee</strong>
        <span>due {formatServiceDate(monthTwo)}</span>
        <em>{formatIncomeMoney(monthly, currency)}</em>
      </li>
      <li>
        <strong>Then every month</strong>
        <span>
          on the {day}
          {ordinal(day)} · next {formatServiceDate(monthThree)}
        </span>
        <em>{formatIncomeMoney(monthly, currency)}</em>
      </li>
    </ol>
  );
}

function ordinal(day: number) {
  if (day >= 11 && day <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}

function ServiceToggle({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`service-toggle ${checked ? "service-toggle-on" : ""}`}>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function FormSection({
  number,
  title,
  description,
  children,
  hidden,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  return (
    <section className="agreement-form-section" hidden={hidden}>
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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
