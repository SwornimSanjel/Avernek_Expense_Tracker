import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import Icon from "@/components/Icons";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import DeleteIncomePayment from "@/components/DeleteIncomePayment";
import EditIncomePayment from "@/components/EditIncomePayment";
import {
  daysUntilDate,
  formatIncomeMoney,
  periodLabel,
  serviceTypeLabel,
  summarizeIncomeAgreement,
} from "@/lib/income";
import { computeMoneyAccountBalances } from "@/lib/funds";
import type {
  Expense,
  IncomeAgreement,
  IncomePayment,
  MoneyAccount,
  MoneyTransfer,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function dueTimingLabel(date: string | null) {
  if (!date) return "No deadline";
  const days = daysUntilDate(date);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function shortDate(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function accountLabel(account: MoneyAccount) {
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

export default async function IncomePage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const [agreements, payments, moneyAccounts, companyExpenses, transfers] = await Promise.all([
    query<IncomeAgreement>(
      `select * from public.income_agreements
       order by case status when 'active' then 0 else 1 end, client_name, agreement_date desc`
    ),
    query<IncomePayment>(
      `select * from public.income_payments order by paid_on desc, created_at desc`
    ),
    query<MoneyAccount>(
      `select * from public.money_accounts where is_active = true order by currency, name`
    ),
    query<Expense>(
      `select * from public.expenses
        where funding_source = 'company_funds'
        order by expense_date desc, created_at desc`
    ),
    query<MoneyTransfer>(
      `select * from public.money_transfers order by transfer_date desc, created_at desc`
    ),
  ]);

  const summaries = new Map(
    agreements.map((agreement) => [
      agreement.id,
      summarizeIncomeAgreement(agreement, payments),
    ])
  );
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));
  const allAccountBalances = computeMoneyAccountBalances(
    moneyAccounts,
    payments,
    companyExpenses,
    transfers
  );
  const nonVatAccount = allAccountBalances.find(
    (item) => item.account.kind === "personal_custody"
  );
  const vatAccount = allAccountBalances.find(
    (item) => item.account.kind === "company_bank"
  );
  const primaryAccounts = [nonVatAccount, vatAccount].filter(
    (item): item is NonNullable<typeof item> => Boolean(item)
  );

  return (
    <div className="income-workspace">
      <PageHeader
        eyebrow="Revenue operations"
        title="Income"
        subtitle="See where client money arrived, what remains in each account, and exactly what every client owes next."
        action={canManage ? <AddIncomeAgreement moneyAccounts={moneyAccounts} /> : undefined}
      />

      <section className="income-account-overview">
        <SectionHeader
          title="Where the money is"
          subtitle="Money in is client income received. Balance left is after company expenses and transfers."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {primaryAccounts.map((item) => (
            <StatTile
              key={`${item.account.id}-in`}
              label={`${accountLabel(item.account)} · Money in`}
              value={formatIncomeMoney(item.received, item.account.currency)}
              hint={item.account.name}
              emphasis
              icon="income"
              tone={item.account.kind === "company_bank" ? "green" : "blue"}
            />
          ))}
          {primaryAccounts.map((item) => (
            <StatTile
              key={`${item.account.id}-left`}
              label={`${accountLabel(item.account)} · Balance left`}
              value={formatIncomeMoney(item.balance, item.account.currency)}
              hint="After expenses and transfers"
              icon={item.account.kind === "company_bank" ? "bank" : "wallet"}
              tone="accent"
            />
          ))}
        </div>
      </section>

      <section className="income-client-board">
        <SectionHeader
          title={`Clients (${agreements.length})`}
          subtitle="One record per client. Setup and recurring payments are kept separate."
        />

        <div className="space-y-4 mt-4">
          {agreements.length === 0 && (
            <div className="card">
              <EmptyState
                title="No client agreements yet"
                description="Add the first agreement to track the first service month, payments, and monthly renewals."
                icon="income"
              />
            </div>
          )}

          {agreements.map((agreement) => {
            const summary = summaries.get(agreement.id)!;
            const agreementPayments = payments.filter(
              (payment) => payment.agreement_id === agreement.id
            );
            const setupAmount = Number(agreement.setup_amount);
            const setupPercent = setupAmount > 0
              ? Math.min(100, Math.round((summary.setupPaid / setupAmount) * 100))
              : 100;
            const serviceDays = daysUntilDate(agreement.ads_live_date);
            const recurringDays = summary.nextRecurringDueDate
              ? daysUntilDate(summary.nextRecurringDueDate)
              : null;
            const nextRecurringPeriod = summary.periods.find(
              (period) => period.remaining > 0
            ) ?? null;
            const paymentDue = summary.totalDueNow > 0;

            return (
              <article id={`client-${agreement.id}`} key={agreement.id} className="income-client-record">
                <header className="income-record-header">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="avatar !w-11 !h-11 text-sm">
                      {agreement.client_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold truncate">{agreement.client_name}</h2>
                        <span className={agreement.status === "active" ? "pill ok" : "pill"}>{agreement.status}</span>
                        {paymentDue && <span className="pill warn">payment due</span>}
                      </div>
                      <p className="text-xs muted mt-1">{serviceTypeLabel(agreement.service_type)}</p>
                    </div>
                  </div>
                  <div className="income-record-actions">
                    <div className="income-record-total">
                      <span>Total received</span>
                      <strong>{formatIncomeMoney(summary.totalCollected, agreement.currency)}</strong>
                    </div>
                    {canManage && (
                      <>
                        <RecordIncomePayment
                          agreement={agreement}
                          setupRemaining={summary.setupRemaining}
                          periods={summary.periods}
                          suggestedPeriod={summary.nextRecurringPeriodStart}
                          moneyAccounts={moneyAccounts}
                        />
                        <IncomeAgreementControls
                          agreement={agreement}
                          moneyAccounts={moneyAccounts}
                          paymentCount={agreementPayments.length}
                        />
                      </>
                    )}
                  </div>
                </header>

                <div className="income-client-metrics">
                  <div>
                    <span>First month agreed</span>
                    <strong>{formatIncomeMoney(setupAmount, agreement.currency)}</strong>
                  </div>
                  <div>
                    <span>Setup paid</span>
                    <strong style={{ color: "var(--green)" }}>{formatIncomeMoney(summary.setupPaid, agreement.currency)}</strong>
                  </div>
                  <div>
                    <span>Setup still left</span>
                    <strong style={{ color: summary.setupRemaining > 0 ? "var(--amber)" : "var(--green)" }}>
                      {formatIncomeMoney(summary.setupRemaining, agreement.currency)}
                    </strong>
                  </div>
                  <div>
                    <span>From month 2</span>
                    <strong>{formatIncomeMoney(Number(agreement.recurring_amount), agreement.currency)} <small>/ month</small></strong>
                  </div>
                </div>

                <div className="income-record-body">
                  <div className="income-setup-status">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="income-section-label">Setup payment</div>
                        <div className="font-semibold mt-1">{setupPercent}% received</div>
                      </div>
                      <div className="tnum text-sm" style={{ color: summary.setupRemaining > 0 ? "var(--amber)" : "var(--green)" }}>
                        {summary.setupRemaining > 0 ? dueTimingLabel(summary.setupNextDueDate) : "Paid in full"}
                      </div>
                    </div>
                    <div className="income-money-bar mt-3" aria-label={`${setupPercent}% of setup received`}>
                      <span className="income-money-paid" style={{ width: `${setupPercent}%` }} />
                      <span className="income-money-left" style={{ width: `${100 - setupPercent}%` }} />
                    </div>
                    <div className="flex justify-between gap-3 text-xs muted mt-2">
                      <span>Paid {formatIncomeMoney(summary.setupPaid, agreement.currency)}</span>
                      <span>Balance due {shortDate(summary.setupNextDueDate)}</span>
                    </div>
                  </div>

                  <div className="income-date-status">
                    <div className="income-date-icon"><Icon name="calendar" size={18} /></div>
                    <div>
                      <div className="income-section-label">Service</div>
                      <div className="font-semibold mt-1">
                        {summary.cycleState === "not_started"
                          ? `Not live yet · starts in ${Math.max(0, serviceDays)} day${serviceDays === 1 ? "" : "s"}`
                          : summary.cycleState === "ended"
                            ? "Service ended"
                            : `Month ${summary.currentCycleNumber} · day ${summary.currentCycleDay}`}
                      </div>
                      <div className="text-xs muted mt-1">
                        Service Day 1: {shortDate(agreement.ads_live_date)}
                        {summary.currentCycleStart && summary.currentCycleEnd
                          ? ` · Current period ${shortDate(summary.currentCycleStart)}–${shortDate(summary.currentCycleEnd)}`
                          : ""}
                      </div>
                    </div>
                  </div>

                  <div className="income-date-status recurring">
                    <div className="income-date-icon"><Icon name="subscription" size={18} /></div>
                    <div>
                      <div className="income-section-label">First / next recurring payment</div>
                      <div className="font-semibold mt-1">
                        {formatIncomeMoney(Number(agreement.recurring_amount), agreement.currency)} · {shortDate(summary.nextRecurringDueDate)}
                      </div>
                      <div className="text-xs muted mt-1">
                        {recurringDays == null ? "No renewal scheduled" : dueTimingLabel(summary.nextRecurringDueDate)}
                        {nextRecurringPeriod
                          ? ` · covers ${shortDate(nextRecurringPeriod.periodStart)}–${shortDate(nextRecurringPeriod.periodEnd)}`
                          : ""}
                      </div>
                    </div>
                  </div>
                </div>

                <details className="income-record-history">
                  <summary>Payment history ({agreementPayments.length})</summary>
                  <div className="divide-y" style={{ borderColor: "var(--line)" }}>
                    {agreementPayments.length === 0 && (
                      <div className="px-5 py-4 text-sm muted">No payment recorded yet.</div>
                    )}
                    {agreementPayments.map((payment) => {
                      const period = payment.billing_period_start
                        ? summary.periods.find((candidate) => candidate.periodStart === payment.billing_period_start)
                        : null;
                      const receivingAccount = payment.money_account_id
                        ? accountById.get(payment.money_account_id)?.name
                        : null;
                      return (
                        <div key={payment.id} className="income-payment-row">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">
                              {payment.payment_for === "setup" ? "Setup payment" : period ? periodLabel(period) : "Recurring payment"}
                            </div>
                            <div className="text-xs muted mt-0.5">
                              {shortDate(payment.paid_on)} · received in {receivingAccount ?? payment.account_name ?? `${payment.received_in} account`}
                              {payment.reference ? ` · ref ${payment.reference}` : ""}
                            </div>
                          </div>
                          <strong className="tnum">{formatIncomeMoney(Number(payment.amount), agreement.currency)}</strong>
                          {canManage && (
                            <div className="flex items-center gap-1">
                              <EditIncomePayment
                                payment={payment}
                                currency={agreement.currency}
                                moneyAccounts={moneyAccounts}
                              />
                              <DeleteIncomePayment id={payment.id} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>

                {agreement.notes && <div className="income-record-note">{agreement.notes}</div>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
