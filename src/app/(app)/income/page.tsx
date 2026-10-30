import Link from "@/components/AppLink";
import { query } from "@/lib/db";
import { requireSection } from "@/lib/auth/server";
import { canView } from "@/lib/access";
import { isAppOwner } from "@/lib/authz";
import { Avatar, Delta, EmptyState, Kpi, Money, PageHeader, SectionHeader } from "@/components/ui";
import Icon from "@/components/Icons";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import AddOtherIncome from "@/components/AddOtherIncome";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import ServiceBadges from "@/components/ServiceBadges";
import StatusPill from "@/components/StatusPill";
import UrlFilters from "@/components/UrlFilters";
import ExportMenu from "@/components/ExportMenu";
import {
  AGREEMENT_STATUS_LABELS,
  OTHER_INCOME_LABELS,
  daysUntilDate,
  formatServiceDate,
  goLiveDate,
  hasRecurringService,
  summarizeIncomeAgreement,
  todayIso,
  type IncomeAgreementSummary,
} from "@/lib/income";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import { formatNumber, percentChange } from "@/lib/format";
import type { IncomeAgreement, ServiceKey } from "@/lib/types";
import { ATTACHMENT_COLUMNS, type Attachment } from "@/lib/attachments";
import { accountLabel } from "@/lib/statement";
import { monthLabel, monthName, shiftMonth } from "@/lib/dates";

export const dynamic = "force-dynamic";

type Filters = {
  service?: string;
  status?: string;
  pay?: string;
  live?: string;
  account?: string;
  q?: string;
};

function dueTiming(date: string | null, today: string) {
  if (!date) return { text: "Nothing scheduled", tone: "" };
  const days = daysUntilDate(date, today);
  if (days < 0) return { text: `${Math.abs(days)} day${days === -1 ? "" : "s"} late`, tone: "text-red" };
  if (days === 0) return { text: "Due today", tone: "text-amber" };
  return { text: `In ${days} day${days === 1 ? "" : "s"}`, tone: days <= 7 ? "text-amber" : "" };
}

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const session = await requireSection("income");
  const canManage = isAppOwner(session);
  const filters = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);

  const [agreements, ledger, agreementFileRows, vatBillRows] = await Promise.all([
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
    query<Attachment>(
      `select ${ATTACHMENT_COLUMNS} from public.attachments
        where kind = 'vat_bill'
        order by created_at`
    ),
  ]);
  const agreementFilesById = new Map<string, Attachment[]>();
  for (const file of agreementFileRows) {
    const list = agreementFilesById.get(file.agreement_id!) ?? [];
    list.push(file);
    agreementFilesById.set(file.agreement_id!, list);
  }
  const { payments, accounts: moneyAccounts, otherIncome } = ledger;

  const summaries = new Map<string, IncomeAgreementSummary>(
    agreements.map((agreement) => [agreement.id, summarizeIncomeAgreement(agreement, payments, today)])
  );
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));

  // ---- KPIs (money that reached the bank)
  const receiptsIn = (key: string) =>
    payments.filter((p) => p.paid_on.startsWith(key)).reduce((sum, p) => sum + bankAmount(p), 0) +
    otherIncome.filter((o) => o.received_on.startsWith(key)).reduce((sum, o) => sum + bankAmount(o), 0);
  const monthIn = receiptsIn(thisMonth);
  const lastMonthIn = receiptsIn(lastMonth);
  const revenueAll =
    payments.reduce((sum, p) => sum + Number(p.amount), 0) + otherIncome.reduce((sum, o) => sum + Number(o.amount), 0);
  const allSummaries = [...summaries.values()];
  const dueNow = allSummaries.reduce((sum, s) => sum + s.totalDueNow, 0);
  const overdue = allSummaries.reduce((sum, s) => sum + s.totalOverdue, 0);
  const recurring = agreements
    .filter((agreement) => agreement.status === "active")
    .reduce((sum, agreement) => sum + summaries.get(agreement.id)!.recurring.monthlyTotal, 0);
  const activeCount = agreements.filter((agreement) => agreement.status === "active").length;

  // Churned clients left us: they get their own section below, unless the
  // status filter asks for them.
  const showChurned = filters.status === "churned";
  const current = agreements.filter((agreement) => agreement.status !== "churned");
  const churned = agreements.filter((agreement) => agreement.status === "churned");

  // Filters run over the computed summaries because payment status and service
  // status are derived, not stored.
  const visible = (showChurned ? churned : current).filter((agreement) => {
    const summary = summaries.get(agreement.id)!;
    if (filters.service && !summary.services.includes(filters.service as ServiceKey)) return false;
    if (filters.status && agreement.status !== filters.status) return false;
    if (filters.pay && summary.overallStatus !== filters.pay) return false;
    if (filters.live === "live" && !summary.serviceLive) return false;
    if (filters.live === "not_live" && summary.serviceLive) return false;
    if (filters.account && agreement.default_money_account_id !== filters.account) {
      const paidInto = payments.some((p) => p.agreement_id === agreement.id && p.money_account_id === filters.account);
      if (!paidInto) return false;
    }
    if (filters.q) {
      const needle = filters.q.trim().toLowerCase();
      if (needle && !agreement.client_name.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Income"
        subtitle="What clients paid, what they still owe, and what comes in next."
        action={
          canManage ? (
            <>
              <AddOtherIncome accounts={moneyAccounts} />
              <AddIncomeAgreement moneyAccounts={moneyAccounts} />
            </>
          ) : undefined
        }
      />

      <div className="kpi-grid">
        <Kpi
          label={`Received · ${monthName(thisMonth, "long")}`}
          icon="income"
          tone="green"
          value={<Money value={monthIn} />}
          foot={<><Delta value={percentChange(monthIn, lastMonthIn)} /><span>vs {monthName(lastMonth, "long")} ({formatNumber(lastMonthIn)})</span></>}
        />
        <Kpi label="Earned all time" icon="trendUp" tone="accent" value={<Money value={revenueAll} />} foot="Bills excluding VAT" />
        <Kpi
          label="To collect now"
          icon="clock"
          tone="amber"
          value={<Money value={dueNow} />}
          foot={overdue > 0 ? <span className="text-red">NPR {formatNumber(overdue)} is overdue</span> : "Nothing overdue"}
        />
        <Kpi label="Monthly recurring" icon="subscription" tone="blue" value={<Money value={recurring} />} foot={`${activeCount} active client${activeCount === 1 ? "" : "s"}`} />
      </div>

      {otherIncome.length > 0 && canView(session.access, "other_income") && (
        <Link href="/other-income" className="income-other-link mt-4">
          <Icon name="sparkles" size={16} />
          <span>
            Plus <strong className="tnum">NPR {formatNumber(otherIncome.reduce((sum, row) => sum + Number(row.amount), 0))}</strong> from{" "}
            {otherIncome.length} job{otherIncome.length === 1 ? "" : "s"} without a client
          </span>
          <span className="ml-auto muted">Other income →</span>
        </Link>
      )}

      {/* clients */}
      <section className="section">
        <SectionHeader
          title={`${showChurned ? "Churned clients" : "Clients"} · ${visible.length === (showChurned ? churned : current).length ? visible.length : `${visible.length} of ${(showChurned ? churned : current).length}`}`}
          subtitle="Open a client for its full billing history."
        />
        <UrlFilters
          values={filters as Record<string, string | undefined>}
          search={{ name: "q", placeholder: "Search clients…" }}
          fields={[
            { name: "status", label: "Any status", options: Object.entries(AGREEMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
            { name: "pay", label: "Any payment", options: [{ value: "paid", label: "Paid" }, { value: "partial", label: "Partly paid" }, { value: "unpaid", label: "Unpaid" }, { value: "overdue", label: "Overdue" }] },
            { name: "service", label: "Any service", options: [{ value: "website", label: "Website" }, { value: "ads", label: "Ads / marketing" }, { value: "automation", label: "AI automation" }] },
            { name: "live", label: "Live or not", options: [{ value: "live", label: "Live" }, { value: "not_live", label: "Not live" }] },
            { name: "account", label: "Both accounts", options: moneyAccounts.map((account) => ({ value: account.id, label: accountLabel(account) })) },
          ]}
          trailing={
            <ExportMenu
              label="Export income"
              choices={[
                { label: "This month", hint: `${monthLabel(thisMonth)} · clients and other income`, href: `/api/export/income?period=month&month=${thisMonth}` },
                { label: "Last month", hint: monthLabel(lastMonth), href: "/api/export/income?period=last" },
                { label: "This year", hint: today.slice(0, 4), href: "/api/export/income?period=year" },
                { label: "All time", hint: "Every payment ever", href: "/api/export/income?period=all" },
              ]}
            />
          }
        />

        <div className="card mt-3 overflow-hidden">
          {agreements.length === 0 && (
            <EmptyState title="No clients yet" description="Add the first client to track setup, monthly fees and every payment." icon="income" />
          )}
          {agreements.length > 0 && visible.length === 0 && (
            <EmptyState title="No clients match" description="Clear the filters to see every client." icon="filter" />
          )}
          {visible.length > 0 && (
            <div className="hidden lg:grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1.45fr)_auto] gap-4 px-5 py-2.5 border-b text-[12.5px] muted font-medium bg-[var(--surface-2)]">
              <span>Client</span>
              <span className="text-right">Received</span>
              <span className="text-right">Setup left</span>
              <span className="text-right">Monthly</span>
              <span>Next payment</span>
              <span className="w-[150px]" />
            </div>
          )}
          <div className="row-list">
            {visible.map((agreement) => {
              const summary = summaries.get(agreement.id)!;
              const agreementPayments = payments.filter((p) => p.agreement_id === agreement.id);
              const oneOffLeft = summary.setup.remaining + (summary.website?.remaining ?? 0);
              const timing = dueTiming(summary.nextDueDate, today);
              return (
                <div key={agreement.id} className="grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1.45fr)_auto] gap-x-4 gap-y-3 items-center px-5 py-4 hover:bg-[var(--hover)] transition-colors">
                  <Link href={`/income/${agreement.id}`} className="flex items-center gap-3 min-w-0">
                    <Avatar name={agreement.client_name} size={40} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold truncate" title={agreement.client_name}>{agreement.client_name}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <StatusPill kind="agreement" value={agreement.status} />
                        {!summary.churned && <StatusPill kind="billing" value={summary.overallStatus} />}
                        <ServiceBadges services={summary.services} />
                      </div>
                    </div>
                  </Link>
                  <Metric label="Received" value={formatNumber(summary.totalCollected)} tone="text-green" />
                  <Metric label="Setup left" value={oneOffLeft > 0 ? formatNumber(oneOffLeft) : "—"} tone={oneOffLeft > 0 ? "text-amber" : "muted"} sub={summary.totalAgreedOneOff ? `of ${formatNumber(summary.totalAgreedOneOff)}` : undefined} />
                  <Metric label="Monthly" value={hasRecurringService(agreement) ? formatNumber(summary.recurring.monthlyTotal) : "—"} sub={hasRecurringService(agreement) && summary.recurring.awaitingStart ? "Not started" : undefined} />
                  <div className="min-w-0">
                    <div className="lg:hidden text-[12.5px] muted">Next payment</div>
                    <div className="text-[14px] font-medium">{summary.nextDueDate ? formatServiceDate(summary.nextDueDate) : "All settled"}</div>
                    <div className="text-[12.5px] truncate">
                      {summary.nextDueDate ? <><span className="muted">{summary.nextDueLabel} · </span><span className={timing.tone || "muted"}>{timing.text}</span></> : <span className="muted">{hasRecurringService(agreement) ? `Day 1 ${formatServiceDate(goLiveDate(agreement), "not set")}` : `Signed ${formatServiceDate(agreement.agreement_date)}`}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 justify-end">
                    {canManage && (
                      <>
                        <RecordIncomePayment agreement={agreement} summary={summary} moneyAccounts={moneyAccounts} compact />
                        <IncomeAgreementControls
                          agreement={agreement}
                          moneyAccounts={moneyAccounts}
                          paymentCount={agreementPayments.length}
                          recurringPaymentCount={agreementPayments.filter((p) => p.payment_for === "recurring").length}
                          agreementFiles={agreementFilesById.get(agreement.id) ?? []}
                          payments={agreementPayments}
                          vatBills={vatBillRows}
                        />
                      </>
                    )}
                    <Link href={`/income/${agreement.id}`} className="icon-btn !w-9 !h-9" aria-label={`Open ${agreement.client_name}`}>
                      <Icon name="chevronRight" size={16} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {!showChurned && churned.length > 0 && (
        <section className="section">
          <SectionHeader
            title={`Churned clients · ${churned.length}`}
            subtitle="They left us. What they still owed is not counted as due."
          />
          <div className="card overflow-hidden">
            <div className="row-list">
              {churned.map((agreement) => {
                const summary = summaries.get(agreement.id)!;
                return (
                  <Link key={agreement.id} href={`/income/${agreement.id}`} className="row-item">
                    <Avatar name={agreement.client_name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="row-title">{agreement.client_name}</div>
                      <div className="row-meta">
                        Left {formatServiceDate(agreement.service_end_date, "—")} · received {formatNumber(summary.totalCollected)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="row-amount muted">{summary.unpaidWhenLeft > 0 ? formatNumber(summary.unpaidWhenLeft) : "—"}</div>
                      <div className="row-sub">{summary.unpaidWhenLeft > 0 ? "unpaid when they left" : "nothing unpaid"}</div>
                    </div>
                    <Icon name="chevronRight" size={16} className="muted shrink-0" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 lg:text-right">
      <div className="lg:hidden text-[12.5px] muted">{label}</div>
      <div className={`text-[15px] font-semibold tnum ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[12.5px] muted tnum">{sub}</div>}
    </div>
  );
}
