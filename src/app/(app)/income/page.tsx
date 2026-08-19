import Link from "next/link";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, LedgerCard, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import Icon from "@/components/Icons";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import DeleteIncomePayment from "@/components/DeleteIncomePayment";
import {
  daysUntilDate,
  formatIncomeMoney,
  periodLabel,
  serviceTypeLabel,
  setupTermsLabel,
  summarizeIncomeAgreement,
} from "@/lib/income";
import { computeMoneyAccountBalances, expenseAmountFromAccount } from "@/lib/funds";
import type {
  Currency,
  Expense,
  IncomeAgreement,
  IncomePayment,
  MoneyAccount,
  MoneyTransfer,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function totalsLabel(values: Map<string, number>) {
  const entries = [...values.entries()].filter(([, amount]) => amount !== 0);
  if (!entries.length) return "NPR 0";
  return entries.map(([currency, amount]) => formatIncomeMoney(amount, currency)).join(" · ");
}

function addTotal(map: Map<string, number>, currency: Currency, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

type CompanyExpense = Expense & {
  category_name: string | null;
  vendor_name: string | null;
};

function dueTimingLabel(date: string | null) {
  if (!date) return "No pending deadline";
  const days = daysUntilDate(date);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
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
    query<CompanyExpense>(
      `select e.*, c.name as category_name, v.name as vendor_name
         from public.expenses e
         left join public.categories c on c.id = e.category_id
         left join public.vendors v on v.id = e.vendor_id
        where e.funding_source = 'company_funds'
        order by e.expense_date desc, e.created_at desc`
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
  const collected = new Map<string, number>();
  const dueNow = new Map<string, number>();
  const setupLeft = new Map<string, number>();
  const activeRecurring = new Map<string, number>();

  for (const agreement of agreements) {
    const summary = summaries.get(agreement.id)!;
    addTotal(collected, agreement.currency, summary.totalCollected);
    addTotal(dueNow, agreement.currency, summary.totalDueNow);
    addTotal(setupLeft, agreement.currency, summary.setupRemaining);
    if (agreement.status === "active") {
      addTotal(activeRecurring, agreement.currency, Number(agreement.recurring_amount));
    }
  }
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));
  const accountBalances = computeMoneyAccountBalances(
    moneyAccounts,
    payments,
    companyExpenses,
    transfers
  );

  return (
    <>
      <PageHeader
        eyebrow="Revenue operations"
        title="Income"
        subtitle="Client agreements, 30-day service cycles, collections, and which Global IME account received every company payment."
        action={canManage ? <AddIncomeAgreement moneyAccounts={moneyAccounts} /> : undefined}
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile label="Collected" value={totalsLabel(collected)} hint="All recorded receipts" emphasis icon="income" tone="green" />
        <StatTile
          label="Due now"
          value={totalsLabel(dueNow)}
          hint="Setup due + recurring due; separated per client below"
          icon="clock"
          tone="amber"
        />
        <StatTile label="Setup left" value={totalsLabel(setupLeft)} hint="Across active and past agreements" icon="receipt" tone="blue" />
        <StatTile label="Active recurring" value={totalsLabel(activeRecurring)} hint="Expected every 30 days" icon="subscription" tone="accent" />
      </div>

      <div className="mb-6">
        <SectionHeader
          title="Company-money account balances"
          subtitle="Receipts increase the selected account; company expenses and transfers reduce it immediately."
        />
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {accountBalances.map((item) => {
            const accountIn = item.received + item.transferredIn;
            const accountOut = item.spent + item.transferredOut;
            const isOfficial = item.account.kind === "company_bank";
            return (
              <Link
                key={item.account.id}
                href={`/expenses?ledger=account:${item.account.id}`}
                className="block"
              >
                <LedgerCard
                  title={item.account.name}
                  subtitle={isOfficial
                    ? "Avernek Technologies official account · VAT-bill collections"
                    : item.account.kind === "personal_custody"
                      ? "Swornim-held account · non-VAT collections · still 100% company money"
                      : "Company operating-money account"}
                  badge={item.account.currency}
                  moneyIn={formatIncomeMoney(accountIn, item.account.currency)}
                  moneyOut={formatIncomeMoney(accountOut, item.account.currency)}
                  balance={formatIncomeMoney(item.balance, item.account.currency)}
                  outLabel="Spent / moved"
                  note="Open the exact expenses deducted from this account"
                  icon={isOfficial ? "bank" : "wallet"}
                  tone={isOfficial ? "green" : "blue"}
                />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <SectionHeader
          title="Recent company-money spending"
          subtitle="These debits are already subtracted from the account balances above; founder/team investment never appears here."
          action={<Link href="/expenses?ledger=company" className="btn !h-9">View all expenses</Link>}
        />
        <div className="card overflow-hidden divide-y mt-3" style={{ borderColor: "var(--line)" }}>
          {companyExpenses.length === 0 && (
            <EmptyState
              title="No company-money spending yet"
              description="Expenses paid from either company-use account will appear here and reduce that account's balance."
              icon="expense"
            />
          )}
          {companyExpenses.slice(0, 8).map((expense) => {
            const account = expense.money_account_id
              ? accountById.get(expense.money_account_id)
              : null;
            const debit = account
              ? expenseAmountFromAccount(expense, account)
              : Number(expense.amount_npr ?? expense.amount);
            const title = expense.note || expense.vendor_name || expense.category_name || "Company expense";
            return (
              <div key={expense.id} className="list-row px-4 py-3 flex items-center gap-3">
                <div className="stat-icon !w-10 !h-10 shrink-0" style={{ color: "var(--red)" }}>
                  <Icon name="expense" size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{title}</div>
                  <div className="text-xs muted mt-0.5 truncate">
                    {expense.expense_date} · {account?.name ?? "Company account"}
                    {expense.client ? ` · client/project: ${expense.client}` : " · shared company cost"}
                    {expense.vendor_name && expense.note ? ` · ${expense.vendor_name}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tnum font-semibold" style={{ color: "var(--red)" }}>
                    −{formatIncomeMoney(debit, account?.currency ?? expense.currency)}
                  </div>
                  {expense.currency !== account?.currency && (
                    <div className="tnum text-xs muted">original {formatIncomeMoney(Number(expense.amount), expense.currency)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {agreements.length > 0 && (
        <div className="mb-6">
          <SectionHeader
            title={`Clients & collection status (${agreements.length})`}
            subtitle="A compact portfolio view. Open any row for its full agreement, billing schedule, and payment history below."
          />
          <div className="card overflow-x-auto mt-3">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-xs muted text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium text-right">Collected</th>
                  <th className="px-4 py-3 font-medium text-right">Setup remaining</th>
                  <th className="px-4 py-3 font-medium text-right">Recurring</th>
                  <th className="px-4 py-3 font-medium">Next recurring date</th>
                  <th className="px-4 py-3 font-medium text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((agreement) => {
                  const summary = summaries.get(agreement.id)!;
                  const recurringDays = summary.nextRecurringDueDate
                    ? daysUntilDate(summary.nextRecurringDueDate)
                    : null;
                  return (
                    <tr key={agreement.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{agreement.client_name}</div>
                        <div className="text-xs muted mt-0.5">{serviceTypeLabel(agreement.service_type)} · {agreement.status}</div>
                      </td>
                      <td className="px-4 py-3 text-right tnum font-medium">{formatIncomeMoney(summary.totalCollected, agreement.currency)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="tnum" style={{ color: summary.setupRemaining > 0 ? "var(--amber)" : "var(--green)" }}>
                          {formatIncomeMoney(summary.setupRemaining, agreement.currency)}
                        </div>
                        <div className="text-xs muted mt-0.5">{summary.setupRemaining > 0 && summary.setupNextDueDate ? `due ${summary.setupNextDueDate}` : "setup settled"}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="tnum" style={{ color: summary.recurringDueNow > 0 ? "var(--amber)" : "var(--green)" }}>
                          {formatIncomeMoney(summary.recurringDueNow, agreement.currency)} due now
                        </div>
                        <div className="text-xs muted mt-0.5">{formatIncomeMoney(Number(agreement.recurring_amount), agreement.currency)} every 30 days</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="tnum">{summary.nextRecurringDueDate ?? "—"}</div>
                        <div className="text-xs mt-0.5" style={{ color: recurringDays != null && recurringDays <= 0 ? "var(--amber)" : "var(--muted)" }}>
                          {dueTimingLabel(summary.nextRecurringDueDate)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`#client-${agreement.id}`} className="btn !h-8">Open</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {agreements.length > 0 && (
        <div className="mb-3">
          <SectionHeader title="Full client details" subtitle="Every added client keeps a complete agreement and payment record here." />
        </div>
      )}

      <div className="space-y-4">
        {agreements.length === 0 && (
          <div className="card"><EmptyState title="No client agreements yet" description="Add the first agreement to track signed dates, ads / automation-live Day 1, payments, and 30-day billing." icon="income" /></div>
        )}

        {agreements.map((agreement) => {
          const agreementPayments = payments.filter(
            (payment) => payment.agreement_id === agreement.id
          );
          const summary = summaries.get(agreement.id)!;
          const recurringDays = summary.nextRecurringDueDate
            ? daysUntilDate(summary.nextRecurringDueDate)
            : null;
          const hasSetupPayment = agreementPayments.some(
            (payment) => payment.payment_for === "setup"
          );
          const setupProgress =
            Number(agreement.setup_amount) > 0
              ? Math.min(100, (summary.setupPaid / Number(agreement.setup_amount)) * 100)
              : 100;
          const nextPeriods = summary.periods
            .filter((period) => period.isDue || period.paid > 0)
            .slice(-6);
          const upcomingPeriods = summary.periods
            .filter((period) => !period.isDue)
            .slice(0, 3);
          const displayedPeriods = [...nextPeriods, ...upcomingPeriods].filter(
            (period, index, all) =>
              all.findIndex((candidate) => candidate.periodStart === period.periodStart) === index
          );

          return (
            <section id={`client-${agreement.id}`} key={agreement.id} className="card overflow-hidden scroll-mt-6">
              <div className="p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex items-start gap-3">
                  <div className="avatar !w-11 !h-11 text-sm">{agreement.client_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold truncate">{agreement.client_name}</h2>
                    <span className={agreement.status === "active" ? "pill ok" : "pill"}>
                      {agreement.status}
                    </span>
                    {summary.totalDueNow > 0 && <span className="pill warn">payment due</span>}
                  </div>
                  <p className="text-sm muted mt-1">
                    {serviceTypeLabel(agreement.service_type)}
                    {agreement.agreement_name ? ` · ${agreement.agreement_name}` : ""}
                    {agreement.contact_name ? ` · ${agreement.contact_name}` : ""}
                  </p>
                  <p className="text-xs muted mt-1">
                    Signed {agreement.agreement_date} · ads / automation live · Service Day 1 {agreement.ads_live_date}
                  </p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
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
                  </div>
                )}
              </div>

              <div className="border-t px-5 py-4" style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="stat-icon" style={{ color: summary.cycleState === "ended" ? "var(--muted)" : "#b8a0fb" }}>
                    <Icon name="clock" size={16} />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    {summary.cycleState === "not_started" ? (
                      <>
                        <div className="text-sm font-semibold">
                          Service starts in {summary.daysUntilNextCycle} {summary.daysUntilNextCycle === 1 ? "day" : "days"}
                        </div>
                        <div className="text-xs muted mt-1">Ads / automation goes live on {agreement.ads_live_date}</div>
                      </>
                    ) : summary.cycleState === "ended" ? (
                      <>
                        <div className="text-sm font-semibold">Service ended</div>
                        <div className="text-xs muted mt-1">No new recurring cycles will be created.</div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">Cycle {summary.currentCycleNumber} · Day {summary.currentCycleDay} of 30</div>
                          <div className="text-xs font-semibold" style={{ color: "#b8a0fb" }}>
                            {summary.daysUntilNextCycle} {summary.daysUntilNextCycle === 1 ? "day" : "days"} left
                          </div>
                        </div>
                        <div className="progress-track mt-2">
                          <div className="progress-fill" style={{ width: `${summary.cycleProgress}%` }} />
                        </div>
                        <div className="flex flex-wrap justify-between gap-2 text-xs muted mt-2">
                          <span>{summary.currentCycleStart} – {summary.currentCycleEnd}</span>
                          <span>Next service cycle starts {summary.nextCycleStart}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {summary.nextRecurringDueDate && (
                    <div className="text-right tnum">
                      <div className="text-xs muted">Next recurring due</div>
                      <div className="text-sm font-semibold mt-1">{summary.nextRecurringDueDate}</div>
                      <div className="text-xs mt-1" style={{ color: recurringDays != null && recurringDays <= 0 ? "var(--amber)" : "var(--muted)" }}>
                        {formatIncomeMoney(Number(agreement.recurring_amount), agreement.currency)} · {dueTimingLabel(summary.nextRecurringDueDate)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid lg:grid-cols-2 border-t" style={{ borderColor: "var(--line)" }}>
                <div className="p-5 lg:border-r" style={{ borderColor: "var(--line)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wider muted font-semibold">Setup / first 30 days</div>
                      <div className="text-sm muted mt-1">{setupTermsLabel(agreement)}</div>
                    </div>
                    <div className="tnum text-right">
                      <div className="font-semibold">{formatIncomeMoney(Number(agreement.setup_amount), agreement.currency)}</div>
                      <div className="text-xs muted">agreed</div>
                    </div>
                  </div>
                  <div className="progress-track mt-4">
                    <div
                      className="progress-fill"
                      style={{ width: `${setupProgress}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                    <div>
                      <div className="muted text-xs">Paid</div>
                      <div className="tnum font-semibold">{formatIncomeMoney(summary.setupPaid, agreement.currency)}</div>
                    </div>
                    <div>
                      <div className="muted text-xs">Left</div>
                      <div className="tnum font-semibold" style={{ color: summary.setupRemaining ? "var(--amber)" : "var(--green)" }}>
                        {formatIncomeMoney(summary.setupRemaining, agreement.currency)}
                      </div>
                    </div>
                  </div>
                  {summary.setupNextDueDate && summary.setupRemaining > 0 && (
                    <p className="text-xs mt-3" style={{ color: summary.setupDueNow ? "var(--amber)" : "var(--muted)" }}>
                      Next setup balance due {summary.setupNextDueDate}
                    </p>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wider muted font-semibold">Recurring from cycle two</div>
                      <div className="text-sm muted mt-1">
                        Due {Number(agreement.recurring_due_days_before) === 0
                          ? "on each billing start"
                          : `${Number(agreement.recurring_due_days_before)} days before billing starts`}
                      </div>
                    </div>
                    <div className="tnum text-right">
                      <div className="font-semibold">{formatIncomeMoney(Number(agreement.recurring_amount), agreement.currency)}</div>
                      <div className="text-xs muted">every 30 days</div>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 mt-4 text-sm">
                    <div>
                      <div className="muted text-xs">Recurring collected</div>
                      <div className="tnum font-semibold">{formatIncomeMoney(summary.recurringPaid, agreement.currency)}</div>
                    </div>
                    <div>
                      <div className="muted text-xs">Recurring due now</div>
                      <div className="tnum font-semibold" style={{ color: summary.recurringDueNow ? "var(--amber)" : "var(--green)" }}>
                        {formatIncomeMoney(summary.recurringDueNow, agreement.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="muted text-xs">Next recurring date</div>
                      <div className="tnum font-semibold">{summary.nextRecurringDueDate ?? "—"}</div>
                      <div className="text-xs mt-0.5" style={{ color: recurringDays != null && recurringDays <= 0 ? "var(--amber)" : "var(--muted)" }}>
                        {dueTimingLabel(summary.nextRecurringDueDate)}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs muted mt-3">
                    Billing clock started {summary.billingAnchorDate} ({hasSetupPayment ? "first setup payment date" : "temporary service-live fallback until the first setup payment"}). Setup remaining above is separate from recurring charges.
                  </p>
                </div>
              </div>

              <details className="border-t" style={{ borderColor: "var(--line)" }}>
                <summary className="px-5 py-3 cursor-pointer text-sm font-medium">
                  30-day billing schedule ({summary.periods.filter((period) => period.isDue).length} started)
                </summary>
                <div className="px-5 pb-4 overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead className="text-xs muted text-left">
                      <tr>
                        <th className="py-2 font-medium">Service cycle</th>
                        <th className="py-2 font-medium">Due date</th>
                        <th className="py-2 font-medium text-right">Agreed</th>
                        <th className="py-2 font-medium text-right">Paid</th>
                        <th className="py-2 font-medium text-right">Left</th>
                        <th className="py-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPeriods.map((period) => (
                        <tr key={period.periodStart} className="border-t" style={{ borderColor: "var(--line)" }}>
                          <td className="py-2.5">{periodLabel(period)}</td>
                          <td className="py-2.5 tnum">{period.dueDate}</td>
                          <td className="py-2.5 tnum text-right">{formatIncomeMoney(period.agreed, agreement.currency)}</td>
                          <td className="py-2.5 tnum text-right">{formatIncomeMoney(period.paid, agreement.currency)}</td>
                          <td className="py-2.5 tnum text-right">{formatIncomeMoney(period.remaining, agreement.currency)}</td>
                          <td className="py-2.5 text-right">
                            <span className={period.remaining === 0 ? "pill ok" : period.isDue ? "pill warn" : "pill"}>
                              {period.remaining === 0 ? "paid" : period.isDue ? "due" : "upcoming"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <details className="border-t" style={{ borderColor: "var(--line)" }}>
                <summary className="px-5 py-3 cursor-pointer text-sm font-medium">
                  Payment history ({agreementPayments.length})
                </summary>
                <div className="divide-y" style={{ borderColor: "var(--line)" }}>
                  {agreementPayments.length === 0 && (
                    <div className="px-5 pb-4 text-sm muted">No payment recorded yet.</div>
                  )}
                  {agreementPayments.map((payment) => {
                    const period = payment.billing_period_start
                      ? summary.periods.find((candidate) => candidate.periodStart === payment.billing_period_start)
                      : null;
                    return (
                      <div key={payment.id} className="list-row px-5 py-3 flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {payment.payment_for === "setup" ? "Setup payment" : period ? periodLabel(period) : "Recurring payment"}
                          </div>
                          <div className="text-xs muted mt-0.5 truncate">
                            Paid {payment.paid_on} · {payment.money_account_id
                              ? accountById.get(payment.money_account_id)?.name ?? payment.account_name ?? "Company account"
                              : payment.account_name ?? `${payment.received_in} account`}
                            {payment.reference ? ` · ref ${payment.reference}` : ""}
                            {payment.note ? ` · ${payment.note}` : ""}
                          </div>
                        </div>
                        <div className="tnum font-semibold">{formatIncomeMoney(Number(payment.amount), agreement.currency)}</div>
                        {canManage && <DeleteIncomePayment id={payment.id} />}
                      </div>
                    );
                  })}
                </div>
              </details>

              {agreement.notes && (
                <div className="border-t px-5 py-3 text-sm muted" style={{ borderColor: "var(--line)" }}>
                  {agreement.notes}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
