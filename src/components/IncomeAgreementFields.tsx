"use client";

import { useMemo, useState } from "react";
import type {
  AdsStatus,
  AutomationStatus,
  Currency,
  IncomeAgreement,
  IncomeAgreementStatus,
  MoneyAccount,
  RecurringBillingMode,
  SetupPaymentTerms,
  WebsiteStatus,
} from "@/lib/types";
import {
  ADS_STATUS_LABELS,
  AGREEMENT_STATUS_LABELS,
  AUTOMATION_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  WEBSITE_STATUS_LABELS,
  addCalendarDays,
  addCalendarMonths,
  formatIncomeMoney,
  formatServiceDate,
  isValidDate,
  todayIso,
} from "@/lib/income";

/**
 * Every editable field of one client agreement.
 *
 * Sections belong to a step. The add-client wizard passes `activeStep` and the
 * rest stay mounted but hidden, so a five-step flow is still one form post and
 * nothing typed on an earlier step is lost. The edit modal passes no step and
 * shows everything.
 *
 * Fields appear only for services the client actually bought: a website-only
 * client is never shown a live date or a monthly fee.
 */

export const AGREEMENT_STEPS = [
  { step: 1, title: "Client", hint: "Who they are and what they bought" },
  { step: 2, title: "Pricing", hint: "Setup, website and monthly amounts" },
  { step: 3, title: "Payment", hint: "Money received so far — Rs. 0 is fine" },
  { step: 4, title: "Services", hint: "Where each service currently stands" },
  { step: 5, title: "Review", hint: "Check and save" },
] as const;

type Props = {
  agreement?: IncomeAgreement;
  moneyAccounts?: MoneyAccount[];
  /** Show the opening-payment step (new clients only). */
  includeInitialPayment?: boolean;
  /** Wizard mode: render only this step and keep the rest mounted but hidden. */
  activeStep?: number;
  /** Warn before moving a billing anchor that already has cycle payments. */
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

  const [hasWebsite, setHasWebsite] = useState(agreement?.has_website ?? false);
  const [hasAds, setHasAds] = useState(agreement?.has_ads ?? true);
  const [hasAutomation, setHasAutomation] = useState(agreement?.has_automation ?? false);
  const [currency, setCurrency] = useState<Currency>(agreement?.currency ?? "NPR");
  const [clientName, setClientName] = useState(agreement?.client_name ?? "");
  const [agreementDate, setAgreementDate] = useState(agreement?.agreement_date ?? today);

  const [setupAmount, setSetupAmount] = useState(
    agreement ? String(Number(agreement.setup_amount)) : ""
  );
  const [setupTerms, setSetupTerms] = useState<SetupPaymentTerms>(
    agreement?.setup_payment_terms ?? "custom"
  );
  const [setupDueDate, setSetupDueDate] = useState(agreement?.setup_due_date ?? today);
  const [websiteAmount, setWebsiteAmount] = useState(
    agreement ? String(Number(agreement.website_amount)) : ""
  );
  const [billingMode, setBillingMode] = useState<RecurringBillingMode>(
    agreement?.recurring_billing_mode ?? "combined"
  );
  const [recurringAmount, setRecurringAmount] = useState(
    agreement ? String(Number(agreement.recurring_amount)) : ""
  );
  const [billingStart, setBillingStart] = useState(
    agreement?.recurring_billing_start_date ?? ""
  );
  const [adsLiveDate, setAdsLiveDate] = useState(agreement?.ads_live_date ?? "");
  const [automationLiveDate, setAutomationLiveDate] = useState(
    agreement?.automation_live_date ?? ""
  );
  const [initialPaid, setInitialPaid] = useState("");
  const [initialFor, setInitialFor] = useState<"setup" | "website">("setup");

  const recurringService = hasAds || hasAutomation;
  const openingPayment = Number(initialPaid || 0);
  const activeAccounts = moneyAccounts.filter(
    (account) => account.is_active && account.currency === currency
  );
  const visible = (step: number) => activeStep == null || activeStep === step;

  const firstCycle = useMemo(() => {
    if (!isValidDate(billingStart)) return null;
    return {
      start: billingStart,
      end: addCalendarDays(addCalendarMonths(billingStart, 1), -1),
      firstInvoice: addCalendarMonths(billingStart, 1),
    };
  }, [billingStart]);

  const setupLeft = Math.max(
    0,
    Number(setupAmount || 0) - (initialFor === "setup" ? openingPayment : 0)
  );
  const websiteLeft = Math.max(
    0,
    Number(websiteAmount || 0) - (initialFor === "website" ? openingPayment : 0)
  );

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- 01 */}
      <FormSection
        number="01"
        title="Client & agreement"
        description="Who the client is, when the agreement started, and which services they bought."
        hidden={!visible(1)}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Client name">
            <input
              name="client_name"
              autoFocus={!agreement}
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="e.g. Nepal Comfort Tour Service"
              className="input"
            />
          </Field>
          <Field label="Agreement start date">
            <input
              name="agreement_date"
              type="date"
              value={agreementDate}
              onChange={(event) => setAgreementDate(event.target.value)}
              className="input"
            />
            <p className="field-help">
              The day the contract was signed or agreed. Not a payment date and not a service-live date.
            </p>
          </Field>
        </div>

        <div className="service-picker mt-3">
          <span className="field-label">Services purchased</span>
          <div className="service-picker-grid mt-2">
            <ServiceToggle
              name="has_website"
              label="Website"
              hint="One-off project billing"
              checked={hasWebsite}
              onChange={setHasWebsite}
            />
            <ServiceToggle
              name="has_ads"
              label="Ads / Marketing"
              hint="Monthly recurring service"
              checked={hasAds}
              onChange={setHasAds}
            />
            <ServiceToggle
              name="has_automation"
              label="AI Automation"
              hint="Monthly recurring service"
              checked={hasAutomation}
              onChange={setHasAutomation}
            />
          </div>
          {!hasWebsite && !hasAds && !hasAutomation && (
            <p className="field-help" style={{ color: "var(--amber)" }}>
              Choose at least one service. Any combination is allowed.
            </p>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Field label="Agreement status">
            <select
              name="status"
              defaultValue={agreement?.status ?? "active"}
              className="input"
            >
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
              onChange={(event) => setCurrency(event.target.value as Currency)}
              className="input"
            >
              <option value="NPR">NPR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          <Field label="Billing account · VAT / non-VAT">
            <select
              name="default_money_account_id"
              defaultValue={agreement?.default_money_account_id ?? ""}
              className="input"
            >
              <option value="">Decide per payment</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountShortLabel(account)}
                </option>
              ))}
            </select>
            <p className="field-help">
              The account this client normally pays into. It only pre-selects the receiving account; every payment can still choose its own.
            </p>
          </Field>
          <Field label="Contract end date (optional)">
            <input
              name="contract_end_date"
              type="date"
              defaultValue={agreement?.contract_end_date ?? ""}
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
          <Field label="Agreement title (optional)">
            <input
              name="agreement_name"
              defaultValue={agreement?.agreement_name ?? ""}
              placeholder="e.g. Growth partnership"
              className="input"
            />
          </Field>
        </div>

        <Field label="Agreement notes (optional)">
          <textarea
            name="notes"
            defaultValue={agreement?.notes ?? ""}
            placeholder="Scope, special conditions, invoice details…"
            className="input !h-20 py-3 resize-none"
          />
        </Field>
      </FormSection>

      {/* ---------------------------------------------------------------- 02 */}
      <FormSection
        number="02"
        title="Pricing"
        description="What was agreed. Amounts paid are never typed here — they come from the payment records."
        hidden={!visible(2)}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Initial / setup agreed amount">
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
          <Field label="Initial / setup payment due date">
            <input
              name="setup_due_date"
              type="date"
              value={setupDueDate}
              onChange={(event) => setSetupDueDate(event.target.value)}
              className="input"
            />
          </Field>
        </div>

        {hasWebsite && (
          <div className="service-block mt-3">
            <div className="service-block-title">Website · one-off project billing</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Website agreed price">
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
              <Field label="Website payment due date">
                <input
                  name="website_due_date"
                  type="date"
                  defaultValue={agreement?.website_due_date ?? ""}
                  className="input"
                />
              </Field>
            </div>
          </div>
        )}

        {recurringService && (
          <div className="service-block mt-3">
            <div className="service-block-title">Monthly recurring billing</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Billing arrangement">
                <select
                  name="recurring_billing_mode"
                  value={billingMode}
                  onChange={(event) => setBillingMode(event.target.value as RecurringBillingMode)}
                  className="input"
                >
                  <option value="combined">One combined monthly fee</option>
                  <option value="separate">Bill each service separately</option>
                </select>
              </Field>
              {billingMode === "combined" ? (
                <Field label="Monthly recurring amount">
                  <input
                    name="recurring_amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={recurringAmount}
                    onChange={(event) => setRecurringAmount(event.target.value)}
                    placeholder="0"
                    className="input tnum"
                  />
                </Field>
              ) : (
                <div />
              )}
            </div>

            {billingMode === "combined" ? (
              <Field label="Recurring billing start date">
                <input
                  name="recurring_billing_start_date"
                  type="date"
                  value={billingStart}
                  onChange={(event) => setBillingStart(event.target.value)}
                  className="input"
                />
                <p className="field-help">
                  Leave blank until the service actually goes live. Marking ads or automation live offers this date automatically, and it stays editable.
                </p>
              </Field>
            ) : (
              <>
                <input
                  type="hidden"
                  name="recurring_billing_start_date"
                  value={billingStart}
                />
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  {hasAds && (
                    <>
                      <Field label="Ads monthly amount">
                        <input
                          name="ads_monthly_amount"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={
                            agreement?.ads_monthly_amount != null
                              ? Number(agreement.ads_monthly_amount)
                              : ""
                          }
                          className="input tnum"
                        />
                      </Field>
                      <Field label="Ads billing start date">
                        <input
                          name="ads_billing_start_date"
                          type="date"
                          defaultValue={agreement?.ads_billing_start_date ?? ""}
                          className="input"
                        />
                      </Field>
                    </>
                  )}
                  {hasAutomation && (
                    <>
                      <Field label="AI automation monthly amount">
                        <input
                          name="automation_monthly_amount"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={
                            agreement?.automation_monthly_amount != null
                              ? Number(agreement.automation_monthly_amount)
                              : ""
                          }
                          className="input tnum"
                        />
                      </Field>
                      <Field label="AI automation billing start date">
                        <input
                          name="automation_billing_start_date"
                          type="date"
                          defaultValue={agreement?.automation_billing_start_date ?? ""}
                          className="input"
                        />
                      </Field>
                    </>
                  )}
                </div>
              </>
            )}

            {billingMode === "combined" && firstCycle && (
              <div className="agreement-balance-preview mt-3">
                <span>First cycle {formatServiceDate(firstCycle.start)} – {formatServiceDate(firstCycle.end)}</span>
                <strong className="!text-sm">
                  Next payment due {formatServiceDate(firstCycle.firstInvoice)}
                </strong>
              </div>
            )}

            <label className="checkbox-row mt-3">
              <input
                type="checkbox"
                name="setup_covers_first_cycle"
                defaultChecked={agreement?.setup_covers_first_cycle ?? true}
              />
              <span>
                <strong>The setup fee covers the first month of service</strong>
                <small>
                  On: the first recurring invoice falls one calendar month after the billing start date. Off: the first invoice is the billing start date itself.
                </small>
              </span>
            </label>

            {recurringPaymentCount > 0 && (
              <label className="checkbox-row mt-2" style={{ borderColor: "var(--amber)" }}>
                <input type="checkbox" name="confirm_billing_change" />
                <span>
                  <strong>I understand this recalculates billing</strong>
                  <small>
                    {recurringPaymentCount} recurring payment
                    {recurringPaymentCount === 1 ? " is" : "s are"} already recorded. Changing the billing start date or arrangement moves every future due date.
                  </small>
                </span>
              </label>
            )}
          </div>
        )}

        <details className="agreement-details mt-3">
          <summary>
            <span>
              <strong>Payment terms &amp; corrections</strong>
              <small>Advance split, due-date lead time, paid-in-full overrides</small>
            </span>
          </summary>
          <div className="p-4 space-y-3 border-t" style={{ borderColor: "var(--line)" }}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Setup payment arrangement">
                <select
                  name="setup_payment_terms"
                  value={setupTerms}
                  onChange={(event) => setSetupTerms(event.target.value as SetupPaymentTerms)}
                  className="input"
                >
                  <option value="full_upfront">Full setup upfront</option>
                  <option value="half_advance">Advance + rest on the service-live day</option>
                  <option value="custom">Custom / partial payments</option>
                </select>
              </Field>
              {setupTerms === "half_advance" ? (
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
              <Field label="Setup paid-in-full date (override)">
                <input
                  name="setup_paid_in_full_date"
                  type="date"
                  defaultValue={agreement?.setup_paid_in_full_date ?? ""}
                  className="input"
                />
                <p className="field-help">
                  Left blank, this is calculated from the payment that cleared the balance.
                </p>
              </Field>
              {recurringService && (
                <Field label="Send the monthly invoice this many days early">
                  <input
                    name="recurring_due_days_before"
                    type="number"
                    min="0"
                    max="30"
                    step="1"
                    defaultValue={agreement ? Number(agreement.recurring_due_days_before) : 0}
                    className="input tnum"
                  />
                </Field>
              )}
              {hasWebsite && (
                <Field label="Website paid-in-full date (override)">
                  <input
                    name="website_paid_in_full_date"
                    type="date"
                    defaultValue={agreement?.website_paid_in_full_date ?? ""}
                    className="input"
                  />
                </Field>
              )}
            </div>
            <Field label="Setup / billing notes (optional)">
              <input
                name="setup_notes"
                defaultValue={agreement?.setup_notes ?? ""}
                placeholder="e.g. 50% advance agreed over the phone"
                className="input"
              />
            </Field>
          </div>
        </details>
      </FormSection>

      {/* ---------------------------------------------------------------- 03 */}
      {includeInitialPayment && (
        <FormSection
          number="03"
          title="Payment received so far"
          description="Record money already in hand, or leave it at zero and add payments later."
          hidden={!visible(3)}
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Amount received now">
              <input
                name="initial_paid_amount"
                type="number"
                min="0"
                step="0.01"
                value={initialPaid}
                onChange={(event) => setInitialPaid(event.target.value)}
                placeholder="0"
                className="input tnum"
              />
              <p className="field-help">Rs. 0 is valid. More payments can be added any time.</p>
            </Field>
            {hasWebsite ? (
              <Field label="This payment is for">
                <select
                  name="initial_payment_for"
                  value={initialFor}
                  onChange={(event) => setInitialFor(event.target.value as "setup" | "website")}
                  className="input"
                >
                  <option value="setup">Initial / setup billing</option>
                  <option value="website">Website project billing</option>
                </select>
              </Field>
            ) : (
              <input type="hidden" name="initial_payment_for" value="setup" />
            )}
          </div>

          {openingPayment > 0 && (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <Field label="Payment received date">
                <input
                  name="initial_paid_on"
                  type="date"
                  defaultValue={today}
                  className="input"
                />
              </Field>
              <Field label={`Received into (${currency})`}>
                <select name="initial_money_account_id" defaultValue="" className="input">
                  <option value="" disabled>
                    Choose receiving account
                  </option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {accountShortLabel(account)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Payment method (optional)">
                <select name="initial_method" defaultValue="" className="input">
                  <option value="">Not recorded</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="agreement-balance-preview">
                <span>Remaining after this payment</span>
                <strong className="tnum">
                  {formatIncomeMoney(
                    initialFor === "setup" ? setupLeft : websiteLeft,
                    currency
                  )}
                </strong>
              </div>
            </div>
          )}
        </FormSection>
      )}

      {/* ---------------------------------------------------------------- 04 */}
      <FormSection
        number={includeInitialPayment ? "04" : "03"}
        title="Service status"
        description="Where each service stands today. Live dates stay blank until the service really goes live."
        hidden={!visible(4)}
      >
        {!hasWebsite && !hasAds && !hasAutomation && (
          <p className="text-xs muted">Select a service on the first step to set its status.</p>
        )}

        {hasWebsite && (
          <div className="service-block">
            <div className="service-block-title">Website</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Website status">
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
              <Field label="Website project start date">
                <input
                  name="website_start_date"
                  type="date"
                  defaultValue={agreement?.website_start_date ?? ""}
                  className="input"
                />
              </Field>
              <Field label="Expected completion date">
                <input
                  name="website_expected_date"
                  type="date"
                  defaultValue={agreement?.website_expected_date ?? ""}
                  className="input"
                />
              </Field>
              <Field label="Website finalized / completed date">
                <input
                  name="website_completed_date"
                  type="date"
                  defaultValue={agreement?.website_completed_date ?? ""}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Website notes (optional)">
              <input
                name="website_notes"
                defaultValue={agreement?.website_notes ?? ""}
                className="input"
              />
            </Field>
          </div>
        )}

        {hasAds && (
          <div className="service-block mt-3">
            <div className="service-block-title">Ads / Marketing</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Ads status">
                <select
                  name="ads_status"
                  defaultValue={agreement?.ads_status ?? "not_started"}
                  className="input"
                >
                  {(Object.keys(ADS_STATUS_LABELS) as AdsStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {ADS_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ads preparation start date (optional)">
                <input
                  name="ads_prep_start_date"
                  type="date"
                  defaultValue={agreement?.ads_prep_start_date ?? ""}
                  className="input"
                />
              </Field>
              <Field label="Ads live date — leave blank until live">
                <input
                  name="ads_live_date"
                  type="date"
                  value={adsLiveDate}
                  onChange={(event) => setAdsLiveDate(event.target.value)}
                  className="input"
                />
                <p className="field-help">
                  Ads often go live 15–20 days after signing. This is never required up front.
                </p>
              </Field>
              <Field label="Ads notes (optional)">
                <input
                  name="ads_notes"
                  defaultValue={agreement?.ads_notes ?? ""}
                  className="input"
                />
              </Field>
            </div>
          </div>
        )}

        {hasAutomation && (
          <div className="service-block mt-3">
            <div className="service-block-title">AI Automation</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Automation status">
                <select
                  name="automation_status"
                  defaultValue={agreement?.automation_status ?? "not_started"}
                  className="input"
                >
                  {(Object.keys(AUTOMATION_STATUS_LABELS) as AutomationStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {AUTOMATION_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Automation live date — leave blank until live">
                <input
                  name="automation_live_date"
                  type="date"
                  value={automationLiveDate}
                  onChange={(event) => setAutomationLiveDate(event.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Automation notes (optional)">
                <input
                  name="automation_notes"
                  defaultValue={agreement?.automation_notes ?? ""}
                  className="input"
                />
              </Field>
            </div>
          </div>
        )}

        {recurringService && !isValidDate(billingStart) && billingMode === "combined" && (
          <p className="field-help mt-3">
            Recurring billing has no start date yet. Add one on the pricing step, or use
            “Mark live” on the client once the service actually starts.
          </p>
        )}
      </FormSection>

      {/* ---------------------------------------------------------------- 05 */}
      {includeInitialPayment && (
        <FormSection
          number="05"
          title="Review"
          description="Confirm what will be saved. Everything here stays editable afterwards."
          hidden={!visible(5)}
        >
          <dl className="review-grid">
            <ReviewRow label="Client" value={clientName || "—"} />
            <ReviewRow
              label="Services"
              value={
                [hasWebsite && "Website", hasAds && "Ads / Marketing", hasAutomation && "AI Automation"]
                  .filter(Boolean)
                  .join(" + ") || "None selected"
              }
            />
            <ReviewRow label="Agreement start" value={formatServiceDate(agreementDate)} />
            <ReviewRow
              label="Setup agreed"
              value={formatIncomeMoney(Number(setupAmount || 0), currency)}
            />
            {hasWebsite && (
              <ReviewRow
                label="Website price"
                value={formatIncomeMoney(Number(websiteAmount || 0), currency)}
              />
            )}
            {recurringService && billingMode === "combined" && (
              <ReviewRow
                label="Monthly recurring"
                value={`${formatIncomeMoney(Number(recurringAmount || 0), currency)} / month`}
              />
            )}
            {recurringService && (
              <ReviewRow
                label="Recurring billing start"
                value={
                  billingMode === "separate"
                    ? "Set per service"
                    : isValidDate(billingStart)
                      ? formatServiceDate(billingStart)
                      : "Not started yet"
                }
              />
            )}
            <ReviewRow
              label="Payment recorded now"
              value={
                openingPayment > 0
                  ? `${formatIncomeMoney(openingPayment, currency)} · ${initialFor === "setup" ? "setup" : "website"}`
                  : "None"
              }
            />
            <ReviewRow
              label="Ads live"
              value={hasAds ? (isValidDate(adsLiveDate) ? formatServiceDate(adsLiveDate) : "Not live yet") : "—"}
            />
            <ReviewRow
              label="Automation live"
              value={
                hasAutomation
                  ? isValidDate(automationLiveDate)
                    ? formatServiceDate(automationLiveDate)
                    : "Not live yet"
                  : "—"
              }
            />
          </dl>
        </FormSection>
      )}
    </div>
  );
}

function accountShortLabel(account: MoneyAccount) {
  if (account.kind === "company_bank") return `VAT account · ${account.name}`;
  if (account.kind === "personal_custody") return `Non-VAT account · ${account.name}`;
  return account.name;
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
