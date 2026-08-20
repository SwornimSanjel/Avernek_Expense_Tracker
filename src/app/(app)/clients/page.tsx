import Link from "next/link";
import AddIncomeAgreement from "@/components/AddIncomeAgreement";
import Icon from "@/components/Icons";
import RecordIncomePayment from "@/components/RecordIncomePayment";
import ClientStatusControl from "@/components/ClientStatusControl";
import IncomeAgreementControls from "@/components/IncomeAgreementControls";
import { EmptyState, PageHeader, StatTile } from "@/components/ui";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { query } from "@/lib/db";
import {
  daysUntilDate,
  formatIncomeMoney,
  serviceTypeLabel,
  summarizeIncomeAgreement,
} from "@/lib/income";
import type {
  Currency,
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

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function normalize(value: string | null) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function addTotal(map: Map<string, number>, currency: Currency, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

function totalsLabel(values: Map<string, number>) {
  const entries = [...values.entries()].filter(([, amount]) => amount !== 0);
  return entries.length
    ? entries.map(([currency, amount]) => formatIncomeMoney(amount, currency)).join(" · ")
    : "NPR 0";
}

function expenseNpr(expense: Expense) {
  return Number(expense.amount_npr ?? expense.actual_npr_charged ?? (expense.currency === "NPR" ? expense.amount : 0));
}

function statusLabel(status: IncomeAgreement["status"]) {
  if (status === "completed") return "Inactive";
  if (status === "paused") return "Paused";
  return "Active";
}

function dueLabel(date: string | null) {
  if (!date) return "Nothing currently due";
  const days = daysUntilDate(date);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const { client: selectedId } = await searchParams;
  const [agreements, payments, expenses, moneyAccounts] = await Promise.all([
    query<IncomeAgreement>(
      `select * from public.income_agreements
       order by case status when 'active' then 0 when 'paused' then 1 else 2 end,
                client_name, agreement_date desc`
    ),
    query<IncomePayment>(
      `select * from public.income_payments order by paid_on desc, created_at desc`
    ),
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
    query<MoneyAccount>(
      `select * from public.money_accounts where is_active = true order by currency, name`
    ),
  ]);

  const summaries = new Map(
    agreements.map((agreement) => [agreement.id, summarizeIncomeAgreement(agreement, payments)])
  );
  const selected = agreements.find((agreement) => agreement.id === selectedId) ?? null;
  const collected = new Map<string, number>();
  const outstanding = new Map<string, number>();
  const recurring = new Map<string, number>();
  let clientSpendNpr = 0;
  let companyClientSpendNpr = 0;

  for (const agreement of agreements) {
    const summary = summaries.get(agreement.id)!;
    addTotal(collected, agreement.currency, summary.totalCollected);
    addTotal(outstanding, agreement.currency, summary.totalDueNow);
    if (agreement.status === "active") {
      addTotal(recurring, agreement.currency, Number(agreement.recurring_amount));
    }
  }
  for (const expense of expenses) {
    clientSpendNpr += expenseNpr(expense);
    if (expense.funding_source === "company_funds") companyClientSpendNpr += expenseNpr(expense);
  }

  const active = agreements.filter((agreement) => agreement.status === "active");
  const paused = agreements.filter((agreement) => agreement.status === "paused");
  const former = agreements.filter((agreement) => agreement.status === "completed");
  const selectedSummary = selected ? summaries.get(selected.id)! : null;
  const selectedPayments = selected
    ? payments.filter((payment) => payment.agreement_id === selected.id)
    : [];
  const selectedExpenses = selected
    ? expenses.filter((expense) => normalize(expense.client) === normalize(selected.client_name))
    : [];
  const selectedAllSpend = selectedExpenses.reduce((sum, expense) => sum + expenseNpr(expense), 0);
  const selectedCompanySpend = selectedExpenses
    .filter((expense) => expense.funding_source === "company_funds")
    .reduce((sum, expense) => sum + expenseNpr(expense), 0);
  const selectedNet = selected && selected.currency === "NPR" && selectedSummary
    ? selectedSummary.totalCollected - selectedAllSpend
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Client operations"
        title="Clients"
        subtitle="See who you are working with, what is recurring, what is due, and every client-linked cost in one place."
        action={canManage ? <AddIncomeAgreement moneyAccounts={moneyAccounts} /> : undefined}
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
        <StatTile label="Active clients" value={String(active.length)} hint={`${agreements.length} total · ${former.length} inactive`} icon="users" tone="accent" />
        <StatTile label="Money in" value={totalsLabel(collected)} hint="All client receipts" icon="income" tone="green" />
        <StatTile label="Due now" value={totalsLabel(outstanding)} hint="Setup + recurring outstanding" icon="clock" tone="amber" />
        <StatTile label="Active recurring" value={totalsLabel(recurring)} hint="Expected every 30 days" icon="subscription" tone="blue" />
        <StatTile label="Client money out" value={formatIncomeMoney(companyClientSpendNpr, "NPR")} hint={`${formatIncomeMoney(clientSpendNpr, "NPR")} incl. founder-paid`} icon="expense" tone="amber" />
      </div>

      <div className="grid lg:grid-cols-[252px_minmax(0,1fr)] gap-5 items-start">
        <aside className="card p-3 lg:sticky lg:top-5 max-h-[72vh] overflow-y-auto">
          <Link href="/clients" className={`client-channel ${!selected ? "client-channel-active" : ""}`}>
            <span className="client-hash">#</span>
            <span className="truncate">all-clients</span>
            <span className="client-count">{agreements.length}</span>
          </Link>
          <ChannelGroup title="Active" agreements={active} selectedId={selected?.id} />
          {paused.length > 0 && <ChannelGroup title="Paused" agreements={paused} selectedId={selected?.id} />}
          {former.length > 0 && <ChannelGroup title="Inactive" agreements={former} selectedId={selected?.id} />}
          {agreements.length === 0 && <p className="px-3 py-5 text-xs muted">Add a client to create the first channel.</p>}
        </aside>

        {!selected ? (
          <Portfolio agreements={agreements} payments={payments} expenses={expenses} summaries={summaries} />
        ) : (
          <section className="space-y-4 min-w-0">
            <div className="card">
              <div className="p-5 md:p-6 border-b" style={{ borderColor: "var(--line)" }}>
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="avatar !w-12 !h-12 !rounded-xl">{initials(selected.client_name)}</div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold truncate"># {selected.client_name}</h2>
                        {Number(selected.recurring_amount) > 0 && <span className="pill">Recurring</span>}
                      </div>
                      <p className="text-xs muted mt-1">{serviceTypeLabel(selected.service_type)} · since {selected.agreement_date}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2.5">
                    {canManage && <ClientStatusControl agreementId={selected.id} status={selected.status} />}
                    {canManage && selectedSummary && (
                      <RecordIncomePayment
                        agreement={selected}
                        setupRemaining={selectedSummary.setupRemaining}
                        periods={selectedSummary.periods}
                        suggestedPeriod={selectedSummary.nextRecurringPeriodStart}
                        moneyAccounts={moneyAccounts}
                      />
                    )}
                    {canManage && (
                      <IncomeAgreementControls
                        agreement={selected}
                        moneyAccounts={moneyAccounts}
                        paymentCount={selectedPayments.length}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-px overflow-hidden rounded-b-[17px]" style={{ background: "var(--line)" }}>
                <Metric label="Collected" value={formatIncomeMoney(selectedSummary!.totalCollected, selected.currency)} tone="var(--green)" />
                <Metric label="Due now" value={formatIncomeMoney(selectedSummary!.totalDueNow, selected.currency)} sub={dueLabel(selectedSummary!.nextRecurringDueDate ?? selectedSummary!.setupNextDueDate)} tone={selectedSummary!.totalDueNow > 0 ? "var(--amber)" : "var(--green)"} />
                <Metric label="Setup left" value={formatIncomeMoney(selectedSummary!.setupRemaining, selected.currency)} />
                <Metric label="Recurring / 30 days" value={formatIncomeMoney(Number(selected.recurring_amount), selected.currency)} />
                <Metric label="Client delivery cost" value={formatIncomeMoney(selectedAllSpend, "NPR")} sub={`${formatIncomeMoney(selectedCompanySpend, "NPR")} paid from company money`} tone="var(--red)" />
                <Metric label="Net contribution" value={selectedNet == null ? "Mixed currencies" : formatIncomeMoney(selectedNet, "NPR")} sub="Collected minus all linked client costs" tone={selectedNet != null && selectedNet < 0 ? "var(--red)" : "var(--green)"} />
              </div>
            </div>

            <div className="grid xl:grid-cols-2 gap-4">
              <ActivityCard
                title="Payments in"
                empty="No payments recorded for this client."
                items={selectedPayments.map((payment) => ({
                  id: payment.id,
                  title: payment.payment_for === "setup" ? "Setup payment" : "Recurring payment",
                  meta: `${payment.paid_on} · ${payment.account_name ?? "Company account"}${payment.reference ? ` · ${payment.reference}` : ""}`,
                  amount: `+${formatIncomeMoney(Number(payment.amount), selected.currency)}`,
                  color: "var(--green)",
                  icon: "income" as const,
                }))}
              />
              <ActivityCard
                title="Money out / delivery costs"
                empty="No expenses are linked to this client yet. Add the client name to an expense to see it here."
                items={selectedExpenses.map((expense) => ({
                  id: expense.id,
                  title: expense.note || expense.vendor_name || expense.category_name || "Client expense",
                  meta: `${expense.expense_date} · ${expense.money_account_name ?? (expense.funding_source === "company_funds" ? "Company money" : "Founder/team investment")}`,
                  amount: `−${formatIncomeMoney(expenseNpr(expense), "NPR")}`,
                  color: "var(--red)",
                  icon: "expense" as const,
                }))}
              />
            </div>

            <div className="card p-5">
              <h3 className="font-semibold">Client record</h3>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4 text-sm">
                <Detail label="Contact" value={selected.contact_name ?? "Not added"} />
                <Detail label="Agreement" value={selected.agreement_name ?? "Standard agreement"} />
                <Detail label="Service live" value={selected.ads_live_date} />
                <Detail label="Status" value={statusLabel(selected.status)} />
              </div>
              <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t" style={{ borderColor: "var(--line)" }}>
                <Link href={`/income#client-${selected.id}`} className="btn !h-9"><Icon name="income" size={14} /> Open billing details</Link>
                <Link href={`/expenses?client=${encodeURIComponent(selected.client_name)}`} className="btn !h-9"><Icon name="expense" size={14} /> View client expenses</Link>
              </div>
              {selected.notes && <p className="text-xs muted mt-4 pt-4 border-t" style={{ borderColor: "var(--line)" }}>{selected.notes}</p>}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function ChannelGroup({ title, agreements, selectedId }: { title: string; agreements: IncomeAgreement[]; selectedId?: string }) {
  return (
    <div className="mt-4">
      <div className="px-3 mb-1 text-[11px] font-bold uppercase tracking-[0.13em] muted">{title} · {agreements.length}</div>
      <div className="space-y-0.5">
        {agreements.map((agreement) => (
          <Link key={agreement.id} href={`/clients?client=${agreement.id}`} className={`client-channel ${selectedId === agreement.id ? "client-channel-active" : ""}`}>
            <span className="client-hash">#</span>
            <span className="truncate flex-1">{agreement.client_name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "client"}</span>
            {Number(agreement.recurring_amount) > 0 && <span className="client-live" title="Recurring client" />}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Portfolio({ agreements, payments, expenses, summaries }: {
  agreements: IncomeAgreement[];
  payments: IncomePayment[];
  expenses: ClientExpense[];
  summaries: Map<string, ReturnType<typeof summarizeIncomeAgreement>>;
}) {
  if (!agreements.length) {
    return <div className="card"><EmptyState title="No client channels yet" description="Add your first client agreement. Its revenue, outstanding amount, recurring cycle, and linked expenses will appear here automatically." icon="users" /></div>;
  }
  return (
    <section className="min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div><h2 className="section-title">All client channels</h2><p className="section-kicker mt-1">Open a channel for its complete cash and collection view.</p></div>
        <Link href="/income" className="btn !h-9">Income ledger</Link>
      </div>
      <div className="grid xl:grid-cols-2 gap-3">
        {agreements.map((agreement) => {
          const summary = summaries.get(agreement.id)!;
          const ownExpenses = expenses.filter((expense) => normalize(expense.client) === normalize(agreement.client_name));
          const spend = ownExpenses.reduce((sum, expense) => sum + expenseNpr(expense), 0);
          const paymentCount = payments.filter((payment) => payment.agreement_id === agreement.id).length;
          return (
            <Link key={agreement.id} href={`/clients?client=${agreement.id}`} className="card client-card p-4 block">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="avatar">{initials(agreement.client_name)}</div>
                  <div className="min-w-0"><h3 className="font-semibold truncate">{agreement.client_name}</h3><p className="text-xs muted mt-0.5">{serviceTypeLabel(agreement.service_type)} · {statusLabel(agreement.status)}</p></div>
                </div>
                <Icon name="arrow" size={15} className="muted shrink-0 mt-2" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <MiniMetric label="Collected" value={formatIncomeMoney(summary.totalCollected, agreement.currency)} />
                <MiniMetric label="Due now" value={formatIncomeMoney(summary.totalDueNow, agreement.currency)} warn={summary.totalDueNow > 0} />
                <MiniMetric label="Recurring" value={formatIncomeMoney(Number(agreement.recurring_amount), agreement.currency)} />
                <MiniMetric label="Client costs" value={formatIncomeMoney(spend, "NPR")} />
              </div>
              <p className="text-[11px] muted mt-3">{paymentCount} payment record{paymentCount === 1 ? "" : "s"} · {ownExpenses.length} linked expense{ownExpenses.length === 1 ? "" : "s"}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className="p-4 min-h-[112px]" style={{ background: "var(--surface)" }}><div className="stat-label">{label}</div><div className="text-xl font-bold tnum mt-3" style={{ color: tone }}>{value}</div>{sub && <div className="text-[11px] muted mt-1">{sub}</div>}</div>;
}

function MiniMetric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}><div className="text-[10px] font-bold uppercase tracking-[0.12em] muted">{label}</div><div className="text-sm font-semibold tnum mt-1" style={{ color: warn ? "var(--amber)" : undefined }}>{value}</div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] uppercase tracking-[0.12em] muted font-bold">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
}

function ActivityCard({ title, empty, items }: { title: string; empty: string; items: { id: string; title: string; meta: string; amount: string; color: string; icon: "income" | "expense" }[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b font-semibold" style={{ borderColor: "var(--line)" }}>{title}</div>
      {!items.length && <p className="p-5 text-xs muted">{empty}</p>}
      {items.slice(0, 10).map((item) => <div key={item.id} className="px-4 py-3 flex items-center gap-3 border-b last:border-b-0" style={{ borderColor: "var(--line)" }}><div className="stat-icon !w-9 !h-9 shrink-0" style={{ color: item.color }}><Icon name={item.icon} size={14} /></div><div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{item.title}</div><div className="text-[11px] muted mt-0.5 truncate">{item.meta}</div></div><div className="text-sm font-semibold tnum shrink-0" style={{ color: item.color }}>{item.amount}</div></div>)}
    </div>
  );
}
