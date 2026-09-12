import Link from "next/link";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import Icon from "@/components/Icons";
import ServiceBadges from "@/components/ServiceBadges";
import StatusPill from "@/components/StatusPill";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import EditIncomePayment from "@/components/EditIncomePayment";
import DeleteIncomePayment from "@/components/DeleteIncomePayment";
import MarkServiceLive from "@/components/MarkServiceLive";
import {
  PAYMENT_METHOD_LABELS,
  daysUntilDate,
  formatIncomeMoney,
  formatServiceDate,
  hasRecurringService,
  periodLabel,
  setupTermsLabel,
  summarizeIncomeAgreement,
  todayIso,
  type BillingBucket,
  type RecurringStreamSummary,
} from "@/lib/income";
import type {
  Expense,
  IncomeAgreement,
  IncomePayment,
  MoneyAccount,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type ClientExpense = Expense & {
  category_name: string | null;
  vendor_name: string | null;
  money_account_name: string | null;
};

function dueTiming(date: string | null) {
  if (!date) return null;
  const days = daysUntilDate(date);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

export default async function ClientBillingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const today = todayIso();

  const agreement = await one<IncomeAgreement>(
    `select * from public.income_agreements where id = $1`,
    [id]
  );
  if (!agreement) notFound();

  const [payments, moneyAccounts, clientExpenses] = await Promise.all([
    query<IncomePayment>(
      `select * from public.income_payments
        where agreement_id = $1
        order by paid_on desc, created_at desc`,
      [id]
    ),
    query<MoneyAccount>(
      `select * from public.money_accounts where is_active = true order by currency, name`
    ),
    query<ClientExpense>(
      `select e.*, c.name as category_name, v.name as vendor_name, ma.name as money_account_name
         from public.expenses e
         left join public.categories c on c.id = e.category_id
         left join public.vendors v on v.id = e.vendor_id
         left join public.money_accounts ma on ma.id = e.money_account_id
        where lower(btrim(e.client)) = lower(btrim($1))
        order by e.expense_date desc, e.created_at desc`,
      [agreement.client_name]
    ),
  ]);

  const summary = summarizeIncomeAgreement(agreement, payments, today);
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));
  const recurringPaymentCount = payments.filter((p) => p.payment_for === "recurring").length;
  const allPeriods = summary.recurring.streams.flatMap((stream) => stream.periods);
  const currency = agreement.currency;

  return (
    <div className="income-workspace">
      <PageHeader
        eyebrow={
          <>
            <Link href="/income" className="hover:opacity-80">
              Income
            </Link>
            {" · client detail"}
          </>
        }
        title={agreement.client_name}
        subtitle={agreement.agreement_name ?? "Every date, balance and payment for this client."}
        action={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <RecordIncomePayment
                agreement={agreement}
                summary={summary}
                moneyAccounts={moneyAccounts}
              />
              <IncomeAgreementControls
                agreement={agreement}
                moneyAccounts={moneyAccounts}
                paymentCount={payments.length}
                recurringPaymentCount={recurringPaymentCount}
                redirectOnDelete="/income"
              />
            </div>
          ) : undefined
        }
      />

      {/* -------------------------------------------------------------- header */}
      <section className="detail-grid">
        <div className="card p-5">
          <div className="detail-label">Client</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <StatusPill kind="agreement" value={agreement.status} />
            <StatusPill kind="billing" value={summary.overallStatus} prefix="Billing:" />
          </div>
          <div className="mt-3">
            <ServiceBadges services={summary.services} size="md" />
          </div>
          {agreement.contact_name && (
            <p className="text-xs muted mt-3">Contact · {agreement.contact_name}</p>
          )}
        </div>

        <div className="card p-5">
          <div className="detail-label">Agreement</div>
          <DetailRow label="Agreement start" value={formatServiceDate(agreement.agreement_date)} />
          <DetailRow
            label="Contract end"
            value={agreement.contract_end_date ? formatServiceDate(agreement.contract_end_date) : "Open-ended"}
          />
          <DetailRow
            label="Billing account"
            value={
              agreement.default_money_account_id
                ? accountKindLabel(accountById.get(agreement.default_money_account_id))
                : "Chosen per payment"
            }
          />
          <DetailRow label="Currency" value={currency} />
        </div>

        <div className="card p-5">
          <div className="detail-label">Money</div>
          <DetailRow
            label="Total received"
            value={formatIncomeMoney(summary.totalCollected, currency)}
            tone="var(--green)"
          />
          <DetailRow
            label="Outstanding now"
            value={formatIncomeMoney(summary.outstanding, currency)}
            tone={summary.outstanding > 0 ? "var(--amber)" : "var(--green)"}
          />
          <DetailRow
            label="Overdue"
            value={formatIncomeMoney(summary.totalOverdue, currency)}
            tone={summary.totalOverdue > 0 ? "var(--red)" : undefined}
          />
          <DetailRow
            label="Next payment due"
            value={
              summary.nextDueDate
                ? `${formatServiceDate(summary.nextDueDate)} · ${summary.nextDueLabel}`
                : "Nothing scheduled"
            }
          />
        </div>
      </section>

      {/* --------------------------------------------------------------------
          Initial / setup billing. Hidden when there is no setup fee and no
          setup payment, so a website-only client is not shown an empty,
          meaningless "paid in full" block.
      -------------------------------------------------------------------- */}
      {(summary.setup.agreed > 0 || summary.setup.payments.length > 0) && (
      <section>
        <div className="billing-panel">
          <div className="billing-panel-head">
            <div>
              <h2>Initial / setup billing</h2>
              <p>{setupTermsLabel(agreement)}</p>
            </div>
            <StatusPill kind="billing" value={summary.setup.status} />
          </div>
          <BucketBody bucket={summary.setup} currency={currency} dueLabel="Setup payment due" />
        </div>
      </section>
      )}

      {/* ------------------------------------------------------------ website */}
      {agreement.has_website && summary.website && (
        <section>
          <div className="billing-panel">
            <div className="billing-panel-head">
              <div>
                <h2>Website</h2>
                <p>One-off project billing</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill kind="website" value={agreement.website_status} />
                <StatusPill kind="billing" value={summary.website.status} />
              </div>
            </div>
            <BucketBody
              bucket={summary.website}
              currency={currency}
              dueLabel="Website payment due"
              extra={[
                { label: "Project start", value: formatServiceDate(agreement.website_start_date, "Not set") },
                { label: "Expected completion", value: formatServiceDate(agreement.website_expected_date, "Not set") },
                {
                  label: "Website finalized",
                  value: formatServiceDate(agreement.website_completed_date, "Not finalized yet"),
                },
              ]}
              note={agreement.website_notes}
            />
          </div>
        </section>
      )}

      {/* --------------------------------------------------------------- ads */}
      {agreement.has_ads && (
        <section>
          <div className="billing-panel">
            <div className="billing-panel-head">
              <div>
                <h2>Ads / Marketing</h2>
                <p>
                  {agreement.ads_live_date
                    ? `Live since ${formatServiceDate(agreement.ads_live_date)}`
                    : "Not live yet — no live date is required until it really starts"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill kind="ads" value={agreement.ads_status} />
                {canManage && agreement.ads_status !== "live" && (
                  <MarkServiceLive
                    agreement={agreement}
                    service="ads"
                    recurringPaymentCount={recurringPaymentCount}
                  />
                )}
              </div>
            </div>
            <div className="billing-panel-body">
              <Fact label="Ads preparation started" value={formatServiceDate(agreement.ads_prep_start_date, "Not recorded")} />
              <Fact label="Ads live date" value={formatServiceDate(agreement.ads_live_date, "Not live yet")} />
              {agreement.recurring_billing_mode === "separate" && (
                <>
                  <Fact
                    label="Ads monthly fee"
                    value={formatIncomeMoney(Number(agreement.ads_monthly_amount ?? 0), currency)}
                  />
                  <Fact
                    label="Ads billing started"
                    value={formatServiceDate(agreement.ads_billing_start_date, "Not started")}
                  />
                </>
              )}
              {agreement.ads_notes && <Fact label="Notes" value={agreement.ads_notes} />}
            </div>
          </div>
        </section>
      )}

      {/* -------------------------------------------------------- automation */}
      {agreement.has_automation && (
        <section>
          <div className="billing-panel">
            <div className="billing-panel-head">
              <div>
                <h2>AI Automation</h2>
                <p>
                  {agreement.automation_live_date
                    ? `Live since ${formatServiceDate(agreement.automation_live_date)}`
                    : "Not live yet — add the live date once the automation actually runs"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill kind="automation" value={agreement.automation_status} />
                {canManage && agreement.automation_status !== "live" && (
                  <MarkServiceLive
                    agreement={agreement}
                    service="automation"
                    recurringPaymentCount={recurringPaymentCount}
                  />
                )}
              </div>
            </div>
            <div className="billing-panel-body">
              <Fact
                label="Automation live date"
                value={formatServiceDate(agreement.automation_live_date, "Not live yet")}
              />
              {agreement.recurring_billing_mode === "separate" && (
                <>
                  <Fact
                    label="Automation monthly fee"
                    value={formatIncomeMoney(Number(agreement.automation_monthly_amount ?? 0), currency)}
                  />
                  <Fact
                    label="Automation billing started"
                    value={formatServiceDate(agreement.automation_billing_start_date, "Not started")}
                  />
                </>
              )}
              {agreement.automation_notes && <Fact label="Notes" value={agreement.automation_notes} />}
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- recurring */}
      {hasRecurringService(agreement) && (
        <section>
          <div className="billing-panel">
            <div className="billing-panel-head">
              <div>
                <h2>Recurring billing</h2>
                <p>
                  {agreement.recurring_billing_mode === "separate"
                    ? "Each service is billed on its own amount and start date"
                    : "One combined monthly fee for the recurring services"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold tnum">
                  {formatIncomeMoney(summary.recurring.monthlyTotal, currency)}
                </div>
                <div className="text-[11px] muted">per month</div>
              </div>
            </div>

            {summary.recurring.awaitingStart ? (
              <div className="billing-panel-body">
                <p className="text-sm muted">
                  Recurring billing has not started. Mark ads or AI automation live — or set the
                  recurring billing start date when editing the client — and monthly cycles begin
                  from that date.
                </p>
              </div>
            ) : (
              summary.recurring.streams.map((stream) => (
                <StreamBlock
                  key={stream.key}
                  stream={stream}
                  currency={currency}
                  showLabel={summary.recurring.streams.length > 1}
                  setupCoversFirstCycle={agreement.setup_covers_first_cycle}
                />
              ))
            )}
          </div>
        </section>
      )}

      {/* --------------------------------------------------- payment history */}
      <section>
        <div className="billing-panel">
          <div className="billing-panel-head">
            <div>
              <h2>Payment history</h2>
              <p>
                {payments.length} payment{payments.length === 1 ? "" : "s"} · every balance on this
                page is calculated from these records
              </p>
            </div>
          </div>
          <div className="payment-table">
            <div className="payment-table-head">
              <span>Payment received</span>
              <span>Type</span>
              <span>Amount</span>
              <span>Account</span>
              <span>Note</span>
              {canManage && <span />}
            </div>
            {payments.length === 0 && (
              <p className="px-5 py-5 text-sm muted">
                No payment recorded yet. Use “Add payment” — a client can sit at Rs. 0 paid for as
                long as needed.
              </p>
            )}
            {payments.map((payment) => {
              const period = payment.billing_period_start
                ? allPeriods.find(
                    (candidate) =>
                      candidate.periodStart === payment.billing_period_start &&
                      candidate.stream === (payment.billing_stream ?? "combined")
                  )
                : null;
              const account = payment.money_account_id
                ? accountById.get(payment.money_account_id)
                : null;
              return (
                <div key={payment.id} className="payment-table-row">
                  <span data-label="Payment received">{formatServiceDate(payment.paid_on)}</span>
                  <span data-label="Type">
                    {payment.payment_for === "setup"
                      ? "Setup"
                      : payment.payment_for === "website"
                        ? "Website"
                        : period
                          ? `Monthly · ${periodLabel(period)}`
                          : "Monthly"}
                  </span>
                  <strong className="tnum" data-label="Amount">
                    {formatIncomeMoney(Number(payment.amount), currency)}
                  </strong>
                  <span data-label="Account">
                    {account ? accountKindLabel(account) : payment.account_name ?? "—"}
                  </span>
                  <span className="truncate" data-label="Note">
                    {[
                      payment.method ? PAYMENT_METHOD_LABELS[payment.method] : null,
                      payment.reference,
                      payment.note,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  {canManage && (
                    <span className="flex items-center justify-end gap-1">
                      <EditIncomePayment
                        payment={payment}
                        currency={currency}
                        moneyAccounts={moneyAccounts}
                        periods={allPeriods}
                      />
                      <DeleteIncomePayment id={payment.id} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- linked costs */}
      <section>
        <div className="billing-panel">
          <div className="billing-panel-head">
            <div>
              <h2>Delivery costs linked to this client</h2>
              <p>Expenses tagged with this client name</p>
            </div>
            <Link
              href={`/expenses?client=${encodeURIComponent(agreement.client_name)}`}
              className="btn !h-9 text-sm"
            >
              <Icon name="expense" size={14} /> Open in expenses
            </Link>
          </div>
          <div className="billing-panel-body">
            {clientExpenses.length === 0 ? (
              <p className="text-sm muted">
                No expense is tagged with this client yet.
              </p>
            ) : (
              <div className="w-full space-y-2">
                {clientExpenses.slice(0, 8).map((expense) => (
                  <div key={expense.id} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {expense.note || expense.vendor_name || expense.category_name || "Client expense"}
                    </span>
                    <span className="text-xs muted">{formatServiceDate(expense.expense_date)}</span>
                    <strong className="tnum" style={{ color: "var(--red)" }}>
                      −{formatIncomeMoney(Number(expense.amount_npr ?? expense.amount), "NPR")}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {agreement.notes && (
        <section>
          <div className="card p-5">
            <div className="detail-label">Agreement notes</div>
            <p className="text-sm mt-2 leading-relaxed">{agreement.notes}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function accountKindLabel(account: MoneyAccount | undefined) {
  if (!account) return "Unassigned account";
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

function BucketBody({
  bucket,
  currency,
  dueLabel,
  extra = [],
  note,
}: {
  bucket: BillingBucket;
  currency: string;
  dueLabel: string;
  extra?: { label: string; value: string }[];
  note?: string | null;
}) {
  const percent = bucket.agreed > 0 ? Math.min(100, Math.round((bucket.paid / bucket.agreed) * 100)) : 100;
  return (
    <>
      <div className="billing-panel-body">
        <Fact label="Agreed" value={formatIncomeMoney(bucket.agreed, currency)} />
        <Fact label="Paid" value={formatIncomeMoney(bucket.paid, currency)} tone="var(--green)" />
        <Fact
          label="Remaining"
          value={formatIncomeMoney(bucket.remaining, currency)}
          tone={bucket.remaining > 0 ? "var(--amber)" : "var(--green)"}
        />
        <Fact
          label={dueLabel}
          value={formatServiceDate(bucket.dueDate, "Not scheduled")}
          sub={bucket.remaining > 0 ? dueTiming(bucket.dueDate) ?? undefined : undefined}
        />
        <Fact
          label="Paid in full on"
          value={formatServiceDate(bucket.paidInFullDate, bucket.remaining > 0 ? "Still open" : "—")}
        />
        {extra.map((item) => (
          <Fact key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
      <div className="px-5 pb-5">
        <div className="income-money-bar" aria-label={`${percent}% received`}>
          <span className="income-money-paid" style={{ width: `${percent}%` }} />
          <span className="income-money-left" style={{ width: `${100 - percent}%` }} />
        </div>
        <div className="flex justify-between gap-3 text-xs muted mt-2">
          <span>{percent}% received</span>
          <span>
            {bucket.payments.length} payment{bucket.payments.length === 1 ? "" : "s"} recorded
          </span>
        </div>
        {note && <p className="text-xs muted mt-3">{note}</p>}
      </div>
    </>
  );
}

function StreamBlock({
  stream,
  currency,
  showLabel,
  setupCoversFirstCycle,
}: {
  stream: RecurringStreamSummary;
  currency: string;
  showLabel: boolean;
  setupCoversFirstCycle: boolean;
}) {
  const recent = [...stream.periods].filter((period) => period.isDue).slice(-4).reverse();
  const upcoming = stream.periods.filter((period) => !period.isDue).slice(0, 2);
  return (
    <div className="stream-block">
      {showLabel && <div className="stream-block-title">{stream.label}</div>}
      <div className="billing-panel-body !border-t-0">
        <Fact label="Monthly fee" value={formatIncomeMoney(stream.monthlyAmount, currency)} />
        <Fact
          label="Recurring billing started"
          value={formatServiceDate(stream.billingStartDate, "Not started")}
          sub={setupCoversFirstCycle ? "Setup covers the first cycle" : "Billed from the first cycle"}
        />
        <Fact
          label="Current billing period"
          value={
            stream.currentPeriodStart
              ? `${formatServiceDate(stream.currentPeriodStart)} – ${formatServiceDate(stream.currentPeriodEnd)}`
              : "Not started"
          }
          sub={stream.started ? `Month ${stream.currentCycleNumber}` : undefined}
        />
        <Fact
          label="Next payment due"
          value={formatServiceDate(stream.nextDuePeriod?.dueDate ?? null, "Nothing due")}
          sub={dueTiming(stream.nextDuePeriod?.dueDate ?? null) ?? undefined}
          tone={stream.overdue > 0 ? "var(--red)" : undefined}
        />
        <Fact
          label="Last payment received"
          value={formatServiceDate(stream.lastPaymentDate, "None yet")}
        />
        <Fact
          label="Recurring collected"
          value={formatIncomeMoney(stream.paid, currency)}
          tone="var(--green)"
        />
      </div>

      {(recent.length > 0 || upcoming.length > 0) && (
        <div className="cycle-list">
          {[...recent, ...upcoming].map((period) => (
            <div key={`${period.stream}-${period.periodStart}`} className="cycle-row">
              <span className="min-w-0 flex-1 truncate">{periodLabel(period)}</span>
              <span className="tnum text-xs muted">
                {formatIncomeMoney(period.paid, currency)} / {formatIncomeMoney(period.agreed, currency)}
              </span>
              {period.isDue ? (
                <StatusPill kind="billing" value={period.status} />
              ) : (
                <span className="status-pill status-pill-muted">Upcoming</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong className="tnum" style={{ color: tone }}>
        {value}
      </strong>
    </div>
  );
}

function Fact({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}
