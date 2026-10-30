import Link from "@/components/AppLink";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import Icon from "@/components/Icons";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import ClientStatusControl from "@/components/ClientStatusControl";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import ClientRail, { type RailClient } from "@/components/ClientRail";
import { Avatar, EmptyState, Kpi, Money, PageHeader, SectionHeader } from "@/components/ui";
import { requireSection } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { query } from "@/lib/db";
import ServiceBadges from "@/components/ServiceBadges";
import StatusPill from "@/components/StatusPill";
import {
  AGREEMENT_STATUS_LABELS,
  agreementServices,
  daysUntilDate,
  formatServiceDate,
  goLiveDate,
  hasRecurringService,
  recurringFromDate,
  servicesLabel,
  summarizeIncomeAgreement,
  todayIso,
} from "@/lib/income";
import { ATTACHMENT_COLUMNS, type Attachment } from "@/lib/attachments";
import { formatNumber } from "@/lib/format";
import { bankAmount } from "@/lib/tax";
import type { Expense, IncomeAgreement, IncomePayment, MoneyAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

type ClientExpense = Expense & {
  category_name: string | null;
  vendor_name: string | null;
  money_account_name: string | null;
};

function normalize(value: string | null) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function expenseNpr(expense: Expense) {
  return Number(expense.amount_npr ?? expense.actual_npr_charged ?? (expense.currency === "NPR" ? expense.amount : 0));
}

function dueLabel(date: string | null, today: string) {
  if (!date) return { text: "Nothing due", tone: "muted" };
  const days = daysUntilDate(date, today);
  if (days < 0) return { text: `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`, tone: "text-red" };
  if (days === 0) return { text: "Due today", tone: "text-amber" };
  return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: days <= 7 ? "text-amber" : "muted" };
}

function groupOf(status: IncomeAgreement["status"]): RailClient["group"] {
  if (status === "active") return "Active";
  if (status === "pending") return "Pending";
  if (status === "paused") return "Paused";
  if (status === "churned") return "Churned";
  return "Inactive";
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await requireSection("clients");
  const canManage = isAppOwner(session);
  const today = todayIso();
  const { client: selectedId } = await searchParams;
  const [agreements, payments, expenses, moneyAccounts] = await Promise.all([
    query<IncomeAgreement>(
      `select * from public.income_agreements
       order by case status when 'active' then 0 when 'pending' then 1 when 'paused' then 2 else 3 end,
                client_name, agreement_date desc`
    ),
    query<IncomePayment>(`select * from public.income_payments order by paid_on desc, created_at desc`),
    query<ClientExpense>(
      `select e.*, c.name as category_name, v.name as vendor_name,
              ma.name as money_account_name
         from public.expenses e
         left join public.categories c on c.id = e.category_id
         left join public.vendors v on v.id = e.vendor_id
         left join public.money_accounts ma on ma.id = e.money_account_id
        where e.client is not null and btrim(e.client) <> ''
        order by e.expense_date desc, e.created_at desc`
    ),
    query<MoneyAccount>(`select * from public.money_accounts where is_active = true order by currency, name`),
  ]);

  const summaries = new Map(agreements.map((agreement) => [agreement.id, summarizeIncomeAgreement(agreement, payments, today)]));
  const costsFor = (agreement: IncomeAgreement) => expenses.filter((expense) => normalize(expense.client) === normalize(agreement.client_name));
  const selected = agreements.find((agreement) => agreement.id === selectedId) ?? null;

  const [selectedAgreementFiles, selectedVatBills] = selected
    ? await Promise.all([
        query<Attachment>(
          `select ${ATTACHMENT_COLUMNS} from public.attachments
            where kind = 'client_agreement' and agreement_id = $1
            order by created_at`,
          [selected.id]
        ),
        query<Attachment>(
          `select ${ATTACHMENT_COLUMNS.split(", ").map((column) => `a.${column}`).join(", ")}
             from public.attachments a
             join public.income_payments p on p.id = a.payment_id
            where a.kind = 'vat_bill' and p.agreement_id = $1
            order by a.created_at`,
          [selected.id]
        ),
      ])
    : [[], []];

  const all = [...summaries.values()];
  const collected = all.reduce((sum, s) => sum + s.totalCollected, 0);
  const dueNow = all.reduce((sum, s) => sum + s.totalDueNow, 0);
  const overdueTotal = all.reduce((sum, s) => sum + s.totalOverdue, 0);
  const active = agreements.filter((agreement) => agreement.status === "active");
  const recurringTotal = active.reduce((sum, agreement) => sum + summaries.get(agreement.id)!.recurring.monthlyTotal, 0);
  const clientCosts = expenses.reduce((sum, expense) => sum + expenseNpr(expense), 0);
  const companyClientCosts = expenses.filter((e) => e.funding_source === "company_funds").reduce((sum, e) => sum + expenseNpr(e), 0);

  const rail: RailClient[] = agreements.map((agreement) => {
    const summary = summaries.get(agreement.id)!;
    return {
      id: agreement.id,
      name: agreement.client_name,
      group: groupOf(agreement.status),
      dueNow: summary.totalDueNow,
      overdue: summary.totalOverdue > 0,
      recurring: hasRecurringService(agreement),
    };
  });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Every client at a glance — what they pay, what they owe, and what they cost to serve."
        action={canManage ? <AddIncomeAgreement moneyAccounts={moneyAccounts} /> : undefined}
      />

      <div className="kpi-grid kpi-grid-5 mb-6">
        <Kpi label="Active clients" icon="users" value={<span className="tnum">{active.length}</span>} foot={`${agreements.length} total · ${agreements.length - active.length} not active`} />
        <Kpi label="Received" icon="income" tone="green" value={<Money value={collected} />} foot="All client payments, excl. VAT" />
        <Kpi
          label="To collect now"
          icon="clock"
          tone="amber"
          value={<Money value={dueNow} />}
          foot={overdueTotal > 0 ? <span className="text-red">NPR {formatNumber(overdueTotal)} overdue</span> : "Nothing overdue"}
        />
        <Kpi label="Monthly recurring" icon="subscription" tone="blue" value={<Money value={recurringTotal} />} foot="From active clients" />
        <Kpi label="Cost to serve" icon="expense" tone="red" value={<Money value={clientCosts} />} foot={`Company money ${formatNumber(companyClientCosts)}`} />
      </div>

      <div className="grid lg:grid-cols-[268px_minmax(0,1fr)] gap-5 items-start">
        <ClientRail clients={rail} selectedId={selected?.id} />

        {!selected ? (
          <section className="min-w-0">
            {agreements.length === 0 ? (
              <div className="card">
                <EmptyState title="No clients yet" description="Add your first client agreement. Payments, dues and linked costs appear here automatically." icon="users" />
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="card-head">
                  <div>
                    <h3>Portfolio</h3>
                    <p>Click a client for its full profile.</p>
                  </div>
                  <Link href="/income" className="btn btn-sm">Income ledger</Link>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th className="num">Received</th>
                        <th className="num">Due now</th>
                        <th className="num">Monthly</th>
                        <th className="num">Net</th>
                        <th>Next payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agreements.map((agreement) => {
                        const summary = summaries.get(agreement.id)!;
                        const costs = costsFor(agreement).reduce((sum, e) => sum + expenseNpr(e), 0);
                        const net = summary.totalCollected - costs;
                        const due = dueLabel(summary.nextDueDate, today);
                        return (
                          <tr key={agreement.id}>
                            <td>
                              <Link href={`/clients?client=${agreement.id}`} className="flex items-center gap-3 min-w-[230px]">
                                <Avatar name={agreement.client_name} size={34} />
                                <span className="min-w-0">
                                  <span className="block font-semibold truncate max-w-[260px]" title={agreement.client_name}>{agreement.client_name}</span>
                                  <span className="flex flex-wrap items-center gap-1 mt-1">
                                    {summary.churned ? <StatusPill kind="agreement" value="churned" /> : <StatusPill kind="billing" value={summary.overallStatus} />}
                                    <ServiceBadges services={agreementServices(agreement)} />
                                  </span>
                                </span>
                              </Link>
                            </td>
                            <td className="num text-green font-medium">{formatNumber(summary.totalCollected)}</td>
                            <td className={`num font-medium ${summary.totalDueNow > 0 ? (summary.totalOverdue > 0 ? "text-red" : "text-amber") : "muted"}`}>
                              {summary.totalDueNow > 0 ? formatNumber(summary.totalDueNow) : "—"}
                            </td>
                            <td className="num">{hasRecurringService(agreement) ? formatNumber(summary.recurring.monthlyTotal) : "—"}</td>
                            <td className="num">
                              <div className={`font-semibold ${net >= 0 ? "" : "text-red"}`}>{formatNumber(net)}</div>
                              <div className="text-[12.5px] muted">{costs ? `cost ${formatNumber(costs)}` : "no costs"}</div>
                            </td>
                            <td className="whitespace-nowrap">
                              <div className="text-[13.5px]">{summary.churned ? "Left us" : summary.nextDueDate ? formatServiceDate(summary.nextDueDate) : "Settled"}</div>
                              <div className={`text-[12.5px] ${summary.churned ? "muted" : due.tone}`}>
                                {summary.churned ? (summary.unpaidWhenLeft > 0 ? `${formatNumber(summary.unpaidWhenLeft)} unpaid, not due` : "Nothing unpaid") : due.text}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        ) : (
          <ClientProfile
            agreement={selected}
            summary={summaries.get(selected.id)!}
            payments={payments.filter((payment) => payment.agreement_id === selected.id)}
            costs={costsFor(selected)}
            moneyAccounts={moneyAccounts}
            canManage={canManage}
            files={selectedAgreementFiles}
            vatBills={selectedVatBills}
            today={today}
          />
        )}
      </div>
    </>
  );
}

function ClientProfile({
  agreement,
  summary,
  payments,
  costs,
  moneyAccounts,
  canManage,
  files,
  vatBills,
  today,
}: {
  agreement: IncomeAgreement;
  summary: ReturnType<typeof summarizeIncomeAgreement>;
  payments: IncomePayment[];
  costs: ClientExpense[];
  moneyAccounts: MoneyAccount[];
  canManage: boolean;
  files: Attachment[];
  vatBills: Attachment[];
  today: string;
}) {
  const allCost = costs.reduce((sum, expense) => sum + expenseNpr(expense), 0);
  const companyCost = costs.filter((e) => e.funding_source === "company_funds").reduce((sum, e) => sum + expenseNpr(e), 0);
  const net = summary.totalCollected - allCost;
  const oneOffLeft = summary.setup.remaining + (summary.website?.remaining ?? 0);
  const due = dueLabel(summary.nextDueDate, today);
  // A churned client's unpaid balance still shows on the bar, greyed out.
  const billedSoFar = summary.totalCollected + (summary.churned ? summary.unpaidWhenLeft : summary.outstanding);
  const paidShare = billedSoFar > 0 ? Math.min(100, (summary.totalCollected / billedSoFar) * 100) : 100;

  return (
    <section className="space-y-4 min-w-0">
      <div className="card overflow-hidden rise">
        <div className="p-5 md:p-6 flex flex-wrap items-start justify-between gap-4 border-b dot-pattern">
          <div className="flex items-start gap-4 min-w-0">
            <Avatar name={agreement.client_name} size={52} />
            <div className="min-w-0">
              <h2 className="text-[22px] font-semibold tracking-tight">{agreement.client_name}</h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <StatusPill kind="agreement" value={agreement.status} />
                {!summary.churned && <StatusPill kind="billing" value={summary.overallStatus} />}
                <ServiceBadges services={agreementServices(agreement)} size="md" />
              </div>
              <p className="text-[13.5px] muted mt-2">
                {agreement.contact_name ? `${agreement.contact_name} · ` : ""}Signed {formatServiceDate(agreement.agreement_date)}
                {hasRecurringService(agreement) ? ` · Day 1 ${formatServiceDate(goLiveDate(agreement), "not set")}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && <ClientStatusControl agreementId={agreement.id} status={agreement.status} />}
            {canManage && <RecordIncomePayment agreement={agreement} summary={summary} moneyAccounts={moneyAccounts} />}
            {canManage && (
              <IncomeAgreementControls
                agreement={agreement}
                moneyAccounts={moneyAccounts}
                paymentCount={payments.length}
                recurringPaymentCount={payments.filter((payment) => payment.payment_for === "recurring").length}
                redirectOnDelete="/clients"
                showEditButton
                agreementFiles={files}
                payments={payments}
                vatBills={vatBills}
              />
            )}
          </div>
        </div>

        <div className="px-5 md:px-6 py-4 border-b">
          <div className="flex items-center justify-between text-[13.5px] mb-2">
            <span className="muted">Paid so far</span>
            <span className="tnum"><strong>{formatNumber(summary.totalCollected)}</strong> <span className="muted">of {formatNumber(billedSoFar)} billed</span></span>
          </div>
          <div className="stack-bar !h-2.5">
            <span style={{ width: `${paidShare}%`, background: "var(--green)" }} />
            {paidShare < 100 && <span style={{ width: `${100 - paidShare}%`, background: summary.churned ? "var(--muted-2)" : summary.totalOverdue > 0 ? "var(--red)" : "var(--amber)" }} />}
          </div>
        </div>

        <dl className="metric-grid">
          <div>
            <dt>Received</dt>
            <dd className="text-green">{formatNumber(summary.totalCollected)}</dd>
            <small>{summary.lastPaymentDate ? `Last on ${formatServiceDate(summary.lastPaymentDate)}` : "No payment yet"}</small>
          </div>
          {summary.churned ? (
            <div>
              <dt>Unpaid when they left</dt>
              <dd className="muted">{formatNumber(summary.unpaidWhenLeft)}</dd>
              <small>Churned · not counted as due</small>
            </div>
          ) : (
            <div>
              <dt>Due now</dt>
              <dd className={summary.totalDueNow > 0 ? (summary.totalOverdue > 0 ? "text-red" : "text-amber") : ""}>{formatNumber(summary.totalDueNow)}</dd>
              <small className={due.tone}>{summary.nextDueDate ? `${summary.nextDueLabel} · ${due.text}` : "All settled"}</small>
            </div>
          )}
          <div>
            <dt>Monthly fee</dt>
            <dd>{hasRecurringService(agreement) ? formatNumber(summary.recurring.monthlyTotal) : "—"}</dd>
            <small>{hasRecurringService(agreement) ? `From ${formatServiceDate(recurringFromDate(agreement), "a month after Day 1")}` : "One-off project"}</small>
          </div>
          <div>
            <dt>Setup & website left</dt>
            <dd className={oneOffLeft > 0 ? "text-amber" : ""}>{formatNumber(oneOffLeft)}</dd>
            <small>of {formatNumber(summary.totalAgreedOneOff)} agreed</small>
          </div>
          <div>
            <dt>Cost to serve</dt>
            <dd>{formatNumber(allCost)}</dd>
            <small>{formatNumber(companyCost)} from company money</small>
          </div>
          <div>
            <dt>Net from this client</dt>
            <dd className={net >= 0 ? "text-green" : "text-red"}>{formatNumber(net)}</dd>
            <small>Received minus costs</small>
          </div>
        </dl>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <div className="card overflow-hidden rise rise-1">
          <div className="card-head">
            <div><h3>Payments in</h3><p>{payments.length} payment{payments.length === 1 ? "" : "s"}</p></div>
            <Link href={`/income/${agreement.id}`} className="link-more">Billing detail <Icon name="arrow" size={14} /></Link>
          </div>
          <div className="row-list">
            {payments.length === 0 && <p className="px-5 py-6 text-[13.5px] muted">No payments recorded yet.</p>}
            {payments.slice(0, 12).map((payment) => (
              <div key={payment.id} className="row-item">
                <div className="row-icon" style={{ "--tone": "var(--green)", "--tone-soft": "var(--green-soft)" } as React.CSSProperties}><Icon name="income" size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="row-title">{payment.payment_for === "setup" ? "Setup fee" : payment.payment_for === "website" ? "Website" : "Monthly fee"}</div>
                  <div className="row-meta">
                    {formatServiceDate(payment.paid_on)} · {moneyAccounts.find((a) => a.id === payment.money_account_id)?.kind === "company_bank" ? "VAT account" : "Non-VAT account"}
                    {Number(payment.vat_amount) > 0 ? ` · +VAT ${formatNumber(Number(payment.vat_amount))}` : ""}
                    {Number(payment.tds_amount) > 0 ? ` · −TDS ${formatNumber(Number(payment.tds_amount))}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="row-amount text-green">+{formatNumber(Number(payment.amount))}</div>
                  {bankAmount(payment) !== Number(payment.amount) && <div className="row-sub">bank {formatNumber(bankAmount(payment))}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden rise rise-2">
          <div className="card-head">
            <div><h3>Cost to serve</h3><p>Expenses tagged with this client</p></div>
            <Link href={`/expenses?client=${encodeURIComponent(agreement.client_name)}&period=all`} className="link-more">All <Icon name="arrow" size={14} /></Link>
          </div>
          <div className="row-list">
            {costs.length === 0 && <p className="px-5 py-6 text-[13.5px] muted">No expenses are tagged with this client. Pick the client on an expense to see it here.</p>}
            {costs.slice(0, 12).map((expense) => (
              <div key={expense.id} className="row-item">
                <div className="row-icon" style={{ "--tone": "var(--red)", "--tone-soft": "var(--red-soft)" } as React.CSSProperties}><Icon name="expense" size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="row-title">{expense.note || expense.vendor_name || expense.category_name || "Client expense"}</div>
                  <div className="row-meta">
                    {formatServiceDate(expense.expense_date)} · {expense.funding_source === "company_funds" ? expense.money_account_name ?? "Company money" : "Founder money"}
                  </div>
                </div>
                <div className="row-amount">−{formatNumber(expenseNpr(expense))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5 md:p-6 rise rise-3">
        <SectionHeader title="Client record" action={<Link href={`/income/${agreement.id}`} className="btn btn-sm"><Icon name="income" size={14} /> Open billing</Link>} />
        <dl className="grid sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-4">
          <Detail label="Contact" value={agreement.contact_name ?? "Not added"} />
          <Detail label="Services" value={servicesLabel(agreement)} />
          <Detail label="Status" value={AGREEMENT_STATUS_LABELS[agreement.status]} />
          <Detail label="Contract signed" value={formatServiceDate(agreement.agreement_date)} />
          <Detail label="Day 1 · launched" value={hasRecurringService(agreement) ? formatServiceDate(goLiveDate(agreement), "Not launched yet") : "—"} />
          <Detail label="Monthly fee from" value={hasRecurringService(agreement) ? formatServiceDate(recurringFromDate(agreement), "A month after Day 1") : "—"} />
          <Detail label="Website delivered" value={agreement.has_website ? formatServiceDate(agreement.website_completed_date, "Not delivered yet") : "—"} />
          <Detail label="Client deducts TDS" value={agreement.deducts_tds ? "Yes · 1.5%" : "No"} />
        </dl>
        {agreement.notes && <p className="text-[13.5px] muted mt-5 pt-4 border-t">{agreement.notes}</p>}
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12.5px] muted">{label}</dt>
      <dd className="mt-1 text-[14.5px] font-medium">{value}</dd>
    </div>
  );
}
