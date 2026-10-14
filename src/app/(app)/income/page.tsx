import Link from "next/link";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import Icon from "@/components/Icons";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import AddOtherIncome from "@/components/AddOtherIncome";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import ServiceBadges from "@/components/ServiceBadges";
import StatusPill from "@/components/StatusPill";
import {
  AGREEMENT_STATUS_LABELS,
  ADS_STATUS_LABELS,
  AUTOMATION_STATUS_LABELS,
  WEBSITE_STATUS_LABELS,
  OTHER_INCOME_LABELS,
  daysUntilDate,
  formatIncomeMoney,
  formatServiceDate,
  goLiveDate,
  hasRecurringService,
  recurringFromDate,
  summarizeIncomeAgreement,
  todayIso,
  type IncomeAgreementSummary,
} from "@/lib/income";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import type { IncomeAgreement, MoneyAccount, ServiceKey } from "@/lib/types";
import { ATTACHMENT_COLUMNS, type Attachment } from "@/lib/attachments";
import { LendMoney, MarkLoanRepaid } from "@/components/LoanActions";

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

  const [agreements, ledger, agreementFileRows, people] = await Promise.all([
    query<IncomeAgreement>(
      `select * from public.income_agreements
       order by case status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 else 3 end,
                client_name, agreement_date desc`
    ),
    loadLedger(),
    query<Attachment>(
      `select ${ATTACHMENT_COLUMNS} from public.attachments
        where kind = 'client_agreement'
        order by created_at`
    ),
    query<{ name: string }>(`select name from public.users order by name`),
  ]);
  const openLoans = ledger.loans.filter((loan) => !loan.repaid_on);
  const agreementFilesById = new Map<string, Attachment[]>();
  for (const file of agreementFileRows) {
    const list = agreementFilesById.get(file.agreement_id!) ?? [];
    list.push(file);
    agreementFilesById.set(file.agreement_id!, list);
  }
  const { payments, accounts: moneyAccounts, balances, otherIncome, tax } = ledger;

  const summaries = new Map<string, IncomeAgreementSummary>(
    agreements.map((agreement) => [
      agreement.id,
      summarizeIncomeAgreement(agreement, payments, today),
    ])
  );
  const nonVat = balances.find((item) => item.account.kind === "personal_custody");
  const vat = balances.find((item) => item.account.kind === "company_bank");
  const primaryAccounts = [vat, nonVat].filter(
    (item): item is NonNullable<typeof item> => Boolean(item)
  );
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));

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
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <AddOtherIncome accounts={moneyAccounts} />
              <AddIncomeAgreement moneyAccounts={moneyAccounts} />
            </div>
          ) : undefined
        }
      />

      <section className="income-account-overview">
        <SectionHeader
          title="Where the money is"
          subtitle="VAT sitting in an account belongs to IRD — only “free to use” is really yours."
          action={
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <LendMoney balances={balances} people={people.map((person) => person.name)} compact />
              )}
              <Link href="/funds" className="btn !h-9 text-sm">
                <Icon name="wallet" size={14} /> Company money
              </Link>
            </div>
          }
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {primaryAccounts.map((item) => (
            <StatTile
              key={`${item.account.id}-in`}
              label={`${accountLabel(item.account)} · in the account`}
              value={formatIncomeMoney(item.balance, item.account.currency)}
              hint={
                item.vatReserved > 0
                  ? `${formatIncomeMoney(item.vatReserved, item.account.currency)} of it is VAT — don't touch`
                  : item.account.name
              }
              emphasis
              icon={item.account.kind === "company_bank" ? "bank" : "wallet"}
              tone={item.account.kind === "company_bank" ? "green" : "blue"}
            />
          ))}
          {primaryAccounts.map((item) => (
            <StatTile
              key={`${item.account.id}-free`}
              label={`${accountLabel(item.account)} · free to use`}
              value={formatIncomeMoney(item.free, item.account.currency)}
              hint="After keeping VAT aside"
              icon="wallet"
              tone="accent"
            />
          ))}
        </div>
        {openLoans.length > 0 && (
          <div className="capital-strip mt-3 !items-start">
            <div className="capital-strip-icon">
              <Icon name="user" size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <strong>
                Loans out · {formatIncomeMoney(openLoans.reduce((sum, loan) => sum + Number(loan.amount), 0), "NPR")} not paid back yet
              </strong>
              <p>Already taken out of the balances above. Mark a loan paid back when the money returns.</p>
              <div className="mt-2 space-y-1.5">
                {openLoans.map((loan) => {
                  const account = moneyAccounts.find((item) => item.id === loan.money_account_id);
                  return (
                    <div key={loan.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1">
                        <strong className="text-[12.5px]">{loan.borrower_name}</strong>{" "}
                        {formatIncomeMoney(Number(loan.amount), account?.currency ?? "NPR")} from{" "}
                        {accountLabel(account ?? moneyAccounts[0])} · taken {formatServiceDate(loan.lent_on)}
                        {loan.note ? ` · ${loan.note}` : ""}
                      </span>
                      {canManage && (
                        <span className="flex items-center gap-1">
                          <MarkLoanRepaid loan={loan} accounts={moneyAccounts} />
                          <LendMoney balances={balances} people={people.map((person) => person.name)} loan={loan} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {(tax.vatOwed > 0 || tax.tdsCredit > 0) && (
          <div className="capital-strip mt-3">
            <div className="capital-strip-icon">
              <Icon name="receipt" size={15} />
            </div>
            <div className="min-w-0">
              <strong>VAT owed {formatIncomeMoney(tax.vatOwed, "NPR")} · TDS credit {formatIncomeMoney(tax.tdsCredit, "NPR")}</strong>
              <p>
                VAT collected minus input VAT from company bills minus VAT already paid. TDS withheld by clients is
                claimed back in the income tax return.
              </p>
            </div>
            <Link href="/funds" className="btn !h-9 shrink-0 text-xs">
              Details
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
                        {!agreementFilesById.has(agreement.id) && (
                          <span className="status-pill status-pill-warn" title="No signed agreement uploaded yet">
                            No agreement
                          </span>
                        )}
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
                          agreementFiles={agreementFilesById.get(agreement.id) ?? []}
                        />
                      </>
                    )}
                  </div>
                </div>

                <dl className="client-summary-metrics">
                  <MetricCell
                    label={hasRecurringService(agreement) ? "Day 1 · launched" : "Contract signed"}
                    value={
                      hasRecurringService(agreement)
                        ? formatServiceDate(goLiveDate(agreement), "Not launched yet")
                        : formatServiceDate(agreement.agreement_date)
                    }
                    sub={`Signed ${formatServiceDate(agreement.agreement_date)}`}
                  />
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
                          ? "Starts a month after Day 1"
                          : `From ${formatServiceDate(recurringFromDate(agreement))}`
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

      <section>
        <SectionHeader
          title={`Income without a client (${otherIncome.length})`}
          subtitle="One-off jobs and extra work that never had an agreement. Counted as income; amounts exclude VAT."
          action={canManage ? <AddOtherIncome accounts={moneyAccounts} compact /> : undefined}
        />
        <div className="card mt-3 overflow-hidden">
          {otherIncome.length === 0 ? (
            <p className="px-5 py-5 text-sm muted">
              Nothing yet. Use “Income without client” for extra work or a website done without an agreement.
            </p>
          ) : (
            otherIncome.map((row) => {
              const account = accountById.get(row.money_account_id);
              return (
                <div key={row.id} className="list-row px-4 py-3 flex items-center gap-3 border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{row.description}</div>
                    <div className="text-[11px] muted mt-0.5 truncate">
                      {formatServiceDate(row.received_on)} · {OTHER_INCOME_LABELS[row.category]}
                      {row.source_name ? ` · from ${row.source_name}` : ""} · {account ? accountLabel(account) : "Account"}
                      {Number(row.vat_amount) > 0 ? ` · VAT ${formatIncomeMoney(Number(row.vat_amount), account?.currency ?? "NPR")}` : ""}
                      {Number(row.tds_amount) > 0 ? ` · TDS ${formatIncomeMoney(Number(row.tds_amount), account?.currency ?? "NPR")}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tnum" style={{ color: "var(--green)" }}>
                      {formatIncomeMoney(Number(row.amount), account?.currency ?? "NPR")}
                    </div>
                    <div className="text-[10px] muted tnum">bank {formatIncomeMoney(bankAmount(row), account?.currency ?? "NPR")}</div>
                  </div>
                  {canManage && <AddOtherIncome accounts={moneyAccounts} record={row} />}
                </div>
              );
            })
          )}
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
