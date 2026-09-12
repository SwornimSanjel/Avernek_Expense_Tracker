import Link from "next/link";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import Icon from "@/components/Icons";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import AddAccountFunds from "@/components/AddAccountFunds";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import ServiceBadges from "@/components/ServiceBadges";
import StatusPill from "@/components/StatusPill";
import {
  AGREEMENT_STATUS_LABELS,
  ADS_STATUS_LABELS,
  AUTOMATION_STATUS_LABELS,
  WEBSITE_STATUS_LABELS,
  daysUntilDate,
  formatIncomeMoney,
  formatServiceDate,
  hasRecurringService,
  summarizeIncomeAgreement,
  todayIso,
  type IncomeAgreementSummary,
} from "@/lib/income";
import { computeMoneyAccountBalances } from "@/lib/funds";
import type {
  CapitalInflow,
  Expense,
  IncomeAgreement,
  IncomePayment,
  MoneyAccount,
  MoneyTransfer,
  ServiceKey,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type Filters = {
  service?: string;
  status?: string;
  pay?: string;
  live?: string;
  account?: string;
  q?: string;
};

function dueTimingLabel(date: string | null) {
  if (!date) return "Nothing scheduled";
  const days = daysUntilDate(date);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

function accountLabel(account: MoneyAccount) {
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

/** What the client is currently getting, in one line. */
function serviceStateLabel(agreement: IncomeAgreement) {
  const parts: string[] = [];
  if (agreement.has_website) parts.push(`Website ${WEBSITE_STATUS_LABELS[agreement.website_status].toLowerCase()}`);
  if (agreement.has_ads) parts.push(`Ads ${ADS_STATUS_LABELS[agreement.ads_status].toLowerCase()}`);
  if (agreement.has_automation) {
    parts.push(`Automation ${AUTOMATION_STATUS_LABELS[agreement.automation_status].toLowerCase()}`);
  }
  return parts.join(" · ") || "No service";
}

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const filters = await searchParams;
  const today = todayIso();

  const [agreements, payments, moneyAccounts, companyExpenses, transfers, capitalInflows] =
    await Promise.all([
      query<IncomeAgreement>(
        `select * from public.income_agreements
         order by case status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 else 3 end,
                  client_name, agreement_date desc`
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
      query<CapitalInflow>(
        `select * from public.capital_inflows order by received_on desc, created_at desc`
      ),
    ]);

  const summaries = new Map<string, IncomeAgreementSummary>(
    agreements.map((agreement) => [
      agreement.id,
      summarizeIncomeAgreement(agreement, payments, today),
    ])
  );
  const balances = computeMoneyAccountBalances(
    moneyAccounts,
    payments,
    companyExpenses,
    transfers,
    capitalInflows
  );
  const nonVat = balances.find((item) => item.account.kind === "personal_custody");
  const vat = balances.find((item) => item.account.kind === "company_bank");
  const primaryAccounts = [nonVat, vat].filter(
    (item): item is NonNullable<typeof item> => Boolean(item)
  );
  const capitalTotal = capitalInflows.reduce((sum, inflow) => sum + Number(inflow.amount), 0);

  // Filters run over the computed summaries because payment status and service
  // status are derived, not stored.
  const visible = agreements.filter((agreement) => {
    const summary = summaries.get(agreement.id)!;
    if (filters.service && !summary.services.includes(filters.service as ServiceKey)) return false;
    if (filters.status && agreement.status !== filters.status) return false;
    if (filters.pay && summary.overallStatus !== filters.pay) return false;
    if (filters.live === "live" && !summary.serviceLive) return false;
    if (filters.live === "not_live" && summary.serviceLive) return false;
    if (filters.account && agreement.default_money_account_id !== filters.account) {
      const paidInto = payments.some(
        (payment) =>
          payment.agreement_id === agreement.id &&
          payment.money_account_id === filters.account
      );
      if (!paidInto) return false;
    }
    if (filters.q) {
      const needle = filters.q.trim().toLowerCase();
      if (needle && !agreement.client_name.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  const filtered =
    Boolean(filters.service || filters.status || filters.pay || filters.live || filters.account || filters.q);

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
          subtitle="Money in is client income. Balance left is after company expenses, transfers and any capital added."
          action={canManage ? <AddAccountFunds accounts={moneyAccounts} compact /> : undefined}
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {primaryAccounts.map((item) => (
            <StatTile
              key={`${item.account.id}-in`}
              label={`${accountLabel(item.account)} · Client money in`}
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
              hint={
                item.capitalIn > 0
                  ? `Includes ${formatIncomeMoney(item.capitalIn, item.account.currency)} capital added`
                  : "After expenses and transfers"
              }
              icon={item.account.kind === "company_bank" ? "bank" : "wallet"}
              tone="accent"
            />
          ))}
        </div>

        {capitalTotal > 0 && (
          <div className="capital-strip mt-3">
            <div className="capital-strip-icon">
              <Icon name="contribution" size={15} />
            </div>
            <div className="min-w-0">
              <strong>Capital &amp; non-revenue funds</strong>
              <p>
                {primaryAccounts
                  .filter((item) => item.capitalIn > 0)
                  .map(
                    (item) =>
                      `${formatIncomeMoney(item.capitalIn, item.account.currency)} in the ${accountLabel(item.account).toLowerCase()}`
                  )
                  .join(" · ")}
                {" — counted in account balances, never in revenue, client income, VAT sales or profit."}
              </p>
            </div>
            <Link href="/funds" className="btn !h-9 shrink-0 text-xs">
              Open ledger
            </Link>
          </div>
        )}
      </section>

      <section className="income-client-board">
        <SectionHeader
          title={`Clients (${filtered ? `${visible.length} of ${agreements.length}` : agreements.length})`}
          subtitle="One record per client. Open a client for its full billing detail and payment history."
        />

        <form className="card p-3 flex flex-wrap gap-2 mt-3 text-sm">
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Search client…"
            aria-label="Search clients"
            className="input !w-full sm:!w-52 !h-10"
          />
          <select
            name="service"
            defaultValue={filters.service ?? ""}
            aria-label="Service filter"
            className="input !w-[calc(50%-4px)] sm:!w-auto !h-10"
          >
            <option value="">All services</option>
            <option value="website">Website</option>
            <option value="ads">Ads / Marketing</option>
            <option value="automation">AI Automation</option>
          </select>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label="Client status filter"
            className="input !w-[calc(50%-4px)] sm:!w-auto !h-10"
          >
            <option value="">All client statuses</option>
            {Object.entries(AGREEMENT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="pay"
            defaultValue={filters.pay ?? ""}
            aria-label="Payment status filter"
            className="input !w-[calc(50%-4px)] sm:!w-auto !h-10"
          >
            <option value="">All payment statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
            <option value="overdue">Overdue</option>
          </select>
          <select
            name="live"
            defaultValue={filters.live ?? ""}
            aria-label="Service status filter"
            className="input !w-[calc(50%-4px)] sm:!w-auto !h-10"
          >
            <option value="">Live and not live</option>
            <option value="live">Live</option>
            <option value="not_live">Not live</option>
          </select>
          <select
            name="account"
            defaultValue={filters.account ?? ""}
            aria-label="Account filter"
            className="input !w-full sm:!w-auto !h-10"
          >
            <option value="">VAT and non-VAT</option>
            {moneyAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
          <button className="btn !h-10">
            <Icon name="filter" size={14} /> Apply
          </button>
          {filtered && (
            <Link href="/income" className="btn !h-10">
              Clear
            </Link>
          )}
        </form>

        <div className="space-y-3 mt-4">
          {agreements.length === 0 && (
            <div className="card">
              <EmptyState
                title="No clients yet"
                description="Add the first client to track services, setup billing, website billing, monthly renewals and every payment."
                icon="income"
              />
            </div>
          )}
          {agreements.length > 0 && visible.length === 0 && (
            <div className="card">
              <EmptyState
                title="No clients match these filters"
                description="Clear the filters to see every client again."
                icon="filter"
              />
            </div>
          )}

          {visible.map((agreement) => {
            const summary = summaries.get(agreement.id)!;
            const agreementPayments = payments.filter(
              (payment) => payment.agreement_id === agreement.id
            );
            const recurringPaymentCount = agreementPayments.filter(
              (payment) => payment.payment_for === "recurring"
            ).length;
            const oneOffRemaining = summary.setup.remaining + (summary.website?.remaining ?? 0);

            return (
              <article id={`client-${agreement.id}`} key={agreement.id} className="client-summary-card">
                <div className="client-summary-main">
                  <Link href={`/income/${agreement.id}`} className="client-summary-identity">
                    <div className="avatar !w-11 !h-11 text-sm">
                      {agreement.client_name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-bold truncate">{agreement.client_name}</h2>
                        <StatusPill kind="agreement" value={agreement.status} />
                        <StatusPill kind="billing" value={summary.overallStatus} />
                      </div>
                      <div className="mt-1.5">
                        <ServiceBadges services={summary.services} />
                      </div>
                    </div>
                  </Link>

                  <div className="client-summary-actions">
                    {canManage && (
                      <>
                        <RecordIncomePayment
                          agreement={agreement}
                          summary={summary}
                          moneyAccounts={moneyAccounts}
                          compact
                        />
                        <IncomeAgreementControls
                          agreement={agreement}
                          moneyAccounts={moneyAccounts}
                          paymentCount={agreementPayments.length}
                          recurringPaymentCount={recurringPaymentCount}
                        />
                      </>
                    )}
                  </div>
                </div>

                <dl className="client-summary-metrics">
                  <MetricCell label="Agreement start" value={formatServiceDate(agreement.agreement_date)} />
                  <MetricCell
                    label="Setup + website left"
                    value={formatIncomeMoney(oneOffRemaining, agreement.currency)}
                    tone={oneOffRemaining > 0 ? "var(--amber)" : "var(--green)"}
                    sub={`of ${formatIncomeMoney(summary.totalAgreedOneOff, agreement.currency)} agreed`}
                  />
                  <MetricCell
                    label="Monthly recurring"
                    value={
                      hasRecurringService(agreement)
                        ? `${formatIncomeMoney(summary.recurring.monthlyTotal, agreement.currency)}`
                        : "—"
                    }
                    sub={
                      !hasRecurringService(agreement)
                        ? "One-off project only"
                        : summary.recurring.awaitingStart
                          ? "Billing not started"
                          : `From ${formatServiceDate(summary.recurring.streams[0]?.billingStartDate ?? null)}`
                    }
                  />
                  <MetricCell label="Service status" value={serviceStateLabel(agreement)} small />
                  <MetricCell
                    label="Next payment due"
                    value={summary.nextDueDate ? formatServiceDate(summary.nextDueDate) : "Nothing due"}
                    sub={
                      summary.nextDueDate
                        ? `${summary.nextDueLabel} · ${dueTimingLabel(summary.nextDueDate)}`
                        : "All balances settled"
                    }
                    tone={summary.totalOverdue > 0 ? "var(--red)" : undefined}
                  />
                  <MetricCell
                    label="Total received"
                    value={formatIncomeMoney(summary.totalCollected, agreement.currency)}
                    sub={
                      summary.lastPaymentDate
                        ? `Last ${formatServiceDate(summary.lastPaymentDate)}`
                        : "No payment yet"
                    }
                    tone="var(--green)"
                  />
                </dl>

                <Link href={`/income/${agreement.id}`} className="client-summary-open">
                  Open client detail
                  <Icon name="arrow" size={14} />
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MetricCell({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={small ? "!text-[12.5px] !font-semibold" : ""} style={{ color: tone }}>
        {value}
      </dd>
      {sub && <p>{sub}</p>}
    </div>
  );
}
