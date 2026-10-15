import Link from "next/link";
import { one, query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { Avatar, Callout, Delta, Kpi, Money, PageHeader, SectionHeader } from "@/components/ui";
import Icon from "@/components/Icons";
import StatementView from "@/components/StatementView";
import LiveFxChip from "@/components/LiveFxChip";
import { CashflowChart, CategoryChart, type CashflowPoint, type CategorySlice } from "@/components/DashboardCharts";
import { GlowTracker } from "@/components/controls";
import { compactNumber, formatNumber, percentChange } from "@/lib/format";
import type { AppUser, Category, Expense, IncomeAgreement, Recurring } from "@/lib/types";
import { computeIndividualSpending } from "@/lib/individual";
import { loadStatement } from "@/lib/statement-data";
import { summarizeIncomeAgreement } from "@/lib/income";
import { getLiveUsdNpr } from "@/lib/market-fx";
import { USER_COLUMNS, displayName, partnersOf, personTone } from "@/lib/people";
import { daysUntilDate } from "@/lib/income";
import { dayLabel, longDate, monthLabel, monthName, monthRange, nepalToday, shiftMonth, shortDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await requireSession();
  const today = nepalToday();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);

  const [statement, shareRows, categories, team, me, agreements, recurring, liveRate] = await Promise.all([
    loadStatement(),
    query<{ expense_id: string; user_id: string; amount: string; amount_npr: string | null }>(
      `select expense_id, user_id, amount, amount_npr from public.expense_shares`
    ),
    query<Category>(`select * from public.categories`),
    query<AppUser>(`select ${USER_COLUMNS} from public.users order by name`),
    one<{ name: string }>(`select name from public.users where id = $1`, [session.sub]),
    query<IncomeAgreement>(`select * from public.income_agreements`),
    query<Recurring>(`select * from public.recurring where is_active = true`),
    getLiveUsdNpr().catch(() => null),
  ]);

  const { ledger, events, accounts, founderExpenses } = statement;
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  // ---- expenses up to today (future-dated rows are mistakes until their day)
  const allExpenses: Expense[] = [
    ...ledger.expenses,
    ...founderExpenses.map((expense) => ({
      ...expense,
      expense_shares: shareRows.filter((share) => share.expense_id === expense.id) as unknown as Expense["expense_shares"],
    })),
  ];
  const future = allExpenses.filter((expense) => expense.expense_date > today);
  const spentRows = allExpenses.filter((expense) => expense.expense_date <= today && expense.amount_npr != null);
  const nprOf = (expense: Expense) => Number(expense.amount_npr ?? 0);
  const sumOf = (rows: Expense[]) => rows.reduce((total, row) => total + nprOf(row), 0);
  const isCompany = (expense: Expense) => expense.funding_source === "company_funds";

  const totalSpent = sumOf(spentRows);
  const totalCompany = sumOf(spentRows.filter(isCompany));
  const monthRows = spentRows.filter((expense) => expense.expense_date.startsWith(thisMonth));
  const monthSpent = sumOf(monthRows);
  const monthCompany = sumOf(monthRows.filter(isCompany));
  const lastMonthSpent = sumOf(spentRows.filter((expense) => expense.expense_date.startsWith(lastMonth)));
  // Same days of last month, so the 15th is compared with the 15th.
  const sameDayLastMonth = `${lastMonth}-${today.slice(8, 10)}`;
  const lastMonthToDate = sumOf(spentRows.filter((expense) => expense.expense_date.startsWith(lastMonth) && expense.expense_date <= sameDayLastMonth));

  // ---- money in (bank receipts; transfers between accounts are not income)
  const incomeIn = (key: string) =>
    events
      .filter((event) => event.direction === "in" && !event.internal && (event.kind === "client" || event.kind === "other_income") && event.date.startsWith(key))
      .reduce((total, event) => total + event.amount, 0);
  const monthIn = incomeIn(thisMonth);
  const lastMonthIn = incomeIn(lastMonth);

  // ---- clients
  const summaries = agreements.map((agreement) => ({ agreement, summary: summarizeIncomeAgreement(agreement, ledger.payments, today) }));
  const dueNow = summaries.reduce((total, row) => total + row.summary.totalDueNow, 0);
  const owing = summaries.filter((row) => row.summary.totalDueNow > 0);
  const overdueCount = summaries.filter((row) => row.summary.totalOverdue > 0).length;

  // ---- accounts
  const vat = ledger.balances.find((item) => item.account.kind === "company_bank");
  const nonVat = ledger.balances.find((item) => item.account.kind === "personal_custody");
  const freeToUse = ledger.balances.reduce((total, item) => total + item.free, 0);
  const founderTotal = sumOf(founderExpenses.filter((expense) => expense.expense_date <= today));

  // ---- partners
  const users = team;
  const partners = partnersOf(users);
  const spending = computeIndividualSpending(users, allExpenses.filter((expense) => !isCompany(expense) && expense.expense_date <= today));
  const partnerRows = spending.filter((row) => partners.some((partner) => partner.id === row.member.id));
  const partnerTotal = partnerRows.reduce((total, row) => total + row.assigned, 0);
  const attributedTotal = spending.reduce((total, row) => total + row.assigned, 0);
  const otherAccounts = Math.max(0, attributedTotal - partnerTotal);

  // ---- charts
  const cashflow: CashflowPoint[] = Array.from({ length: 12 }, (_, index) => shiftMonth(thisMonth, index - 11)).map((key) => {
    const point: CashflowPoint = { key, label: monthName(key), moneyIn: 0, companyOut: 0, founderOut: 0 };
    for (const event of events) {
      if (!event.date.startsWith(key) || event.date > today || event.internal) continue;
      if (event.account === "founder") point.founderOut += event.amount;
      else if (event.direction === "in") point.moneyIn += event.amount;
      else point.companyOut += event.amount;
    }
    return point;
  });
  const slicesFor = (from: string) => {
    const map = new Map<string, number>();
    for (const expense of spentRows) {
      if (expense.expense_date < from) continue;
      const name = expense.category_id ? categoryName.get(expense.category_id) ?? "Uncategorised" : "Uncategorised";
      map.set(name, (map.get(name) ?? 0) + nprOf(expense));
    }
    return [...map.entries()].map(([name, value]) => ({ name, value })) as CategorySlice[];
  };

  // ---- coming up: client payments and renewals in the next 30 days (or late)
  const upcoming = [
    ...summaries
      .filter(({ agreement, summary }) => summary.nextDueDate && ["active", "pending", "paused", "completed"].includes(agreement.status))
      .map(({ agreement, summary }) => {
        const amount =
          summary.nextDueLabel === "Setup charge"
            ? summary.setup.remaining
            : summary.nextDueLabel === "Website balance"
              ? summary.website?.remaining ?? 0
              : summary.recurring.nextDuePeriod?.remaining ?? summary.recurring.monthlyTotal;
        return {
          key: `a-${agreement.id}`,
          date: summary.nextDueDate!,
          title: agreement.client_name,
          detail: summary.nextDueLabel ?? "Payment",
          amount,
          direction: "in" as const,
          href: `/income/${agreement.id}`,
        };
      }),
    ...recurring.map((item) => ({
      key: `r-${item.id}`,
      date: item.next_renewal_date,
      title: item.name,
      detail: `${item.cycle === "annual" ? "Annual" : "Monthly"} renewal`,
      amount: item.currency === "USD" ? Number(item.amount) * (liveRate?.nrb?.sell ?? liveRate?.rate ?? 0) : Number(item.amount),
      direction: "out" as const,
      href: "/subscriptions",
    })),
  ]
    .filter((item) => item.amount > 0 && daysUntilDate(item.date, today) <= 30)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 7);

  const recent = events
    .filter((event) => (event.kind === "expense" || event.kind === "founder") && event.date <= today)
    .slice(0, 7);

  const name = displayName(me?.name ?? session.name);
  const monthDelta = percentChange(monthSpent, lastMonthToDate);
  const inDelta = percentChange(monthIn, lastMonthIn);

  return (
    <>
      <PageHeader
        title={`Good to see you, ${name}`}
        subtitle={`${longDate(today)} · Here's where Avernek's money stands today.`}
        action={<LiveFxChip initial={liveRate} />}
      />

      {/* ------------------------------------------------------------ KPIs */}
      <div className="kpi-grid">
        <Kpi
          label="Total spent"
          icon="wallet"
          tone="accent"
          value={<Money value={totalSpent} />}
          foot={<>Company <strong className="tnum text-[var(--ink-2)]">{compactNumber(totalCompany)}</strong> · Founders <strong className="tnum text-[var(--ink-2)]">{compactNumber(totalSpent - totalCompany)}</strong></>}
          href="/expenses?period=all"
        />
        <Kpi
          label={`Spent in ${monthName(thisMonth, "long")}`}
          icon="calendar"
          tone="blue"
          value={<Money value={monthSpent} />}
          foot={
            <>
              <Delta value={monthDelta} goodWhenDown />
              <span>vs same days of {monthName(lastMonth, "long")} · company {compactNumber(monthCompany)}</span>
            </>
          }
          href="/expenses"
        />
        <Kpi
          label={`Money in · ${monthName(thisMonth, "long")}`}
          icon="income"
          tone="green"
          value={<Money value={monthIn} />}
          foot={<><Delta value={inDelta} /><span>vs all of {monthName(lastMonth, "long")} ({compactNumber(lastMonthIn)})</span></>}
          href="/income"
        />
        <Kpi
          label="To collect now"
          icon="clock"
          tone="amber"
          value={<Money value={dueNow} />}
          foot={dueNow > 0 ? <>{owing.length} client{owing.length === 1 ? "" : "s"} owe{owing.length === 1 ? "s" : ""}{overdueCount ? <> · <span className="text-red">{overdueCount} overdue</span></> : null}</> : "Every client is settled"}
          href="/clients"
        />
      </div>

      {future.length > 0 && (
        <Callout
          className="mt-4"
          tone="amber"
          icon="alert"
          title={`${future.length} expense${future.length === 1 ? " is" : "s are"} dated in the future`}
          action={<Link href="/expenses?period=future" className="btn btn-sm">Review dates</Link>}
        >
          {future
            .slice(0, 3)
            .map((expense) => `${shortDate(expense.expense_date)} · NPR ${formatNumber(nprOf(expense))}`)
            .join("  ·  ")}
          {" "}— left out of every total until that day. They were probably meant for this year.
        </Callout>
      )}

      {/* --------------------------------------------------------- accounts */}
      <section className="section">
        <SectionHeader
          title="Accounts"
          subtitle={<>Free to use across company accounts: <strong className="text-[var(--ink)] tnum">NPR {formatNumber(freeToUse)}</strong></>}
          action={<Link href="/funds" className="link-more">Company money <Icon name="arrow" size={14} /></Link>}
        />
        <GlowTracker className="grid lg:grid-cols-3 gap-4">
          {vat && (
            <AccountCard
              href="/funds"
              icon="bank"
              tone="var(--green)"
              title="VAT account"
              subtitle="Avernek Technologies · Global IME"
              balance={vat.balance}
              moneyIn={vat.revenue + vat.vatIn - vat.tdsWithheld + vat.capitalIn + vat.transferredIn + vat.loanRepaidIn}
              moneyOut={vat.spent + vat.transferredOut + vat.vatPaid + vat.lentOut}
              split={{ free: vat.free, reserved: vat.vatReserved }}
              note={vat.capitalIn > 0 ? `Includes NPR ${formatNumber(vat.capitalIn)} capital added (not revenue)` : undefined}
            />
          )}
          {nonVat && (
            <AccountCard
              href="/funds"
              icon="wallet"
              tone="var(--blue)"
              title="Non-VAT account"
              subtitle="Held by Swornim · Global IME · company money"
              balance={nonVat.balance}
              moneyIn={nonVat.revenue + nonVat.vatIn - nonVat.tdsWithheld + nonVat.capitalIn + nonVat.transferredIn + nonVat.loanRepaidIn}
              moneyOut={nonVat.spent + nonVat.transferredOut + nonVat.vatPaid + nonVat.lentOut}
              split={{ free: nonVat.free, reserved: nonVat.vatReserved }}
              note={nonVat.loanedOut > 0 ? `NPR ${formatNumber(nonVat.loanedOut)} lent out, not back yet` : undefined}
            />
          )}
          <div className="card glow-card p-5 flex flex-col rise rise-2">
            <div className="flex items-center gap-3">
              <div className="row-icon" style={{ "--tone": "var(--pink)", "--tone-soft": "rgb(244 114 182 / 0.12)" } as React.CSSProperties}>
                <Icon name="contribution" size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">Founder money</div>
                <div className="text-[13px] muted">Own-pocket spending · all time</div>
              </div>
            </div>
            <div className="mt-4 text-[28px] font-semibold tracking-tight"><Money value={founderTotal} /></div>
            <div className="mt-4 space-y-3 flex-1">
              {partnerRows.map((row, index) => (
                <div key={row.member.id}>
                  <div className="flex items-center justify-between text-[13.5px]">
                    <span className="flex items-center gap-2"><span className="dot" style={{ color: personTone(index) }} />{row.member.name}</span>
                    <span className="tnum font-medium">{formatNumber(Math.round(row.assigned))}</span>
                  </div>
                  <div className="bar-track mt-1.5 !h-1.5">
                    <div className="bar-fill" style={{ width: `${partnerTotal ? (row.assigned / partnerTotal) * 100 : 0}%`, "--bar": personTone(index) } as React.CSSProperties} />
                  </div>
                </div>
              ))}
            </div>
            <Link href="/settlements" className="link-more mt-4">Partner breakdown <Icon name="arrow" size={14} /></Link>
          </div>
        </GlowTracker>
      </section>

      {/* ----------------------------------------------------------- charts */}
      <section className="section grid xl:grid-cols-2 gap-4">
        <CashflowChart points={cashflow} />
        <CategoryChart
          periods={{
            month: slicesFor(monthRange(thisMonth).from),
            quarter: slicesFor(monthRange(shiftMonth(thisMonth, -2)).from),
            all: slicesFor("0000-01-01"),
          }}
        />
      </section>

      {/* ---------------------------------------------------- three panels */}
      <section className="section grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="card overflow-hidden rise">
          <div className="card-head">
            <div>
              <h3>Partner investment</h3>
              <p>Founder money, by partner</p>
            </div>
            <Link href="/settlements" className="link-more">Details <Icon name="arrow" size={14} /></Link>
          </div>
          <div className="row-list">
            {partnerRows.map((row, index) => (
              <Link key={row.member.id} href={`/expenses?person=${row.member.id}&basis=share&period=all`} className="row-item">
                <Avatar name={row.member.name} color={personTone(index)} size={36} round />
                <div className="min-w-0 flex-1">
                  <div className="row-title">{row.member.name}</div>
                  <div className="row-meta">Paid personally NPR {formatNumber(Math.round(row.paid))}</div>
                </div>
                <div className="text-right">
                  <div className="row-amount">{formatNumber(row.assigned)}</div>
                  <div className="row-sub">{attributedTotal ? Math.round((row.assigned / attributedTotal) * 100) : 0}% of total</div>
                </div>
              </Link>
            ))}
            <div className="row-item !py-3 bg-[var(--surface-2)]">
              <div className="flex-1 text-[14px] font-semibold">Total invested</div>
              <div className="row-amount">NPR {formatNumber(attributedTotal)}</div>
            </div>
          </div>
          {otherAccounts > 0.009 && (
            <p className="px-5 py-3 text-[12.5px] muted border-t">
              NPR {formatNumber(otherAccounts)} sits with sign-in accounts from older default splits.
            </p>
          )}
        </div>

        <div className="card overflow-hidden rise rise-1">
          <div className="card-head">
            <div>
              <h3>Latest expenses</h3>
              <p>Most recent first · up to today</p>
            </div>
            <Link href="/expenses" className="link-more">All <Icon name="arrow" size={14} /></Link>
          </div>
          <div className="row-list">
            {recent.length === 0 && <p className="px-5 py-6 text-[13.5px] muted">No expenses yet.</p>}
            {recent.map((event) => (
              <Link key={event.id} href={event.href ?? "/expenses"} className="row-item">
                <div className="min-w-0 flex-1">
                  <div className="row-title">{event.title}</div>
                  <div className="row-meta">
                    {dayLabel(event.date)} · {event.kind === "founder" ? "Founder-paid" : accounts.find((a) => a.id === event.account)?.label ?? "Company"}
                    {event.category ? ` · ${event.category}` : ""}
                  </div>
                </div>
                <div className="row-amount">−{formatNumber(event.amount)}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden rise rise-2">
          <div className="card-head">
            <div>
              <h3>Coming up</h3>
              <p>Next 30 days · and anything late</p>
            </div>
            <Link href="/clients" className="link-more">Clients <Icon name="arrow" size={14} /></Link>
          </div>
          <div className="row-list">
            {upcoming.length === 0 && <p className="px-5 py-6 text-[13.5px] muted">Nothing due in the next 30 days.</p>}
            {upcoming.map((item) => {
              const days = daysUntilDate(item.date, today);
              return (
                <Link key={item.key} href={item.href} className="row-item">
                  <div className="text-center w-11 shrink-0">
                    <div className="text-[11.5px] uppercase muted font-semibold">{monthName(item.date.slice(0, 7))}</div>
                    <div className="text-[18px] font-semibold tnum leading-tight">{Number(item.date.slice(8, 10))}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="row-title">{item.title}</div>
                    <div className="row-meta">
                      {item.detail} ·{" "}
                      <span className={days < 0 ? "text-red" : days <= 3 ? "text-amber" : ""}>
                        {days < 0 ? `${-days} day${days === -1 ? "" : "s"} late` : days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </div>
                  <div className={`row-amount ${item.direction === "in" ? "text-green" : ""}`}>
                    {item.direction === "in" ? "+" : "−"}{formatNumber(Math.round(item.amount))}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- statement */}
      <section className="section">
        <SectionHeader
          title="Statement"
          subtitle={`Every rupee in and out, month by month — ${monthLabel(thisMonth)} so far.`}
          action={<Link href="/statement" className="link-more">Full page <Icon name="arrow" size={14} /></Link>}
        />
        <StatementView events={events} accounts={accounts} today={today} compact />
      </section>
    </>
  );
}

function AccountCard({
  href,
  icon,
  tone,
  title,
  subtitle,
  balance,
  moneyIn,
  moneyOut,
  split,
  note,
}: {
  href: string;
  icon: "bank" | "wallet";
  tone: string;
  title: string;
  subtitle: string;
  balance: number;
  moneyIn: number;
  moneyOut: number;
  split: { free: number; reserved: number };
  note?: string;
}) {
  const total = Math.max(split.free + split.reserved, 1);
  return (
    <Link href={href} className="card glow-card card-interactive p-5 flex flex-col rise rise-1">
      <div className="flex items-center gap-3">
        <div className="row-icon" style={{ "--tone": tone, "--tone-soft": `color-mix(in srgb, ${tone} 14%, transparent)` } as React.CSSProperties}>
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="text-[13px] muted truncate">{subtitle}</div>
        </div>
      </div>
      <div className="mt-4 text-[13px] muted">Balance</div>
      <div className="text-[28px] font-semibold tracking-tight leading-tight"><Money value={balance} /></div>
      {split.reserved > 0 ? (
        <div className="mt-3">
          <div className="stack-bar">
            <span style={{ width: `${(Math.max(split.free, 0) / total) * 100}%`, background: tone }} />
            <span style={{ width: `${(split.reserved / total) * 100}%`, background: "var(--amber)" }} />
          </div>
          <div className="flex justify-between mt-2 text-[13px]">
            <span><span className="dot mr-1.5" style={{ color: tone }} />Free <strong className="tnum">{formatNumber(split.free)}</strong></span>
            <span><span className="dot mr-1.5" style={{ color: "var(--amber)" }} />VAT for IRD <strong className="tnum">{formatNumber(split.reserved)}</strong></span>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[13px] muted">All of it is free to use</div>
      )}
      <div className="grid grid-cols-2 gap-2 mt-4">
        <div className="card-soft px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] muted"><Icon name="arrowDownLeft" size={13} className="text-green" />Money in</div>
          <div className="mt-0.5 text-[15px] font-semibold tnum">{formatNumber(moneyIn)}</div>
        </div>
        <div className="card-soft px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] muted"><Icon name="arrowUpRight" size={13} className="text-red" />Money out</div>
          <div className="mt-0.5 text-[15px] font-semibold tnum">{formatNumber(moneyOut)}</div>
        </div>
      </div>
      {note && <p className="mt-3 text-[12.5px] muted">{note}</p>}
    </Link>
  );
}
