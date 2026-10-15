import Link from "next/link";
import { one, query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { getCachedUsdSellRate } from "@/lib/fx";
import { EmptyState, FxBadge, LedgerCard, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import { npr, usd } from "@/lib/format";
import type {
  AppUser,
  Category,
  Expense,
  Recurring,
  Vendor,
} from "@/lib/types";
import { computeIndividualSpending } from "@/lib/individual";
import { loadLedger } from "@/lib/ledger";
import { formatIncomeMoney } from "@/lib/income";
import { format, startOfMonth, addMonths } from "date-fns";
import DashboardCharts from "@/components/DashboardCharts";
import { expenseTotals, groupExpenses, projectedRenewalsNpr } from "@/lib/expense-summary";
import { sumMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await requireSession();

  const [exp, shareRows, cats, vends, recs, team, me, currentRate, ledger] =
    await Promise.all([
      query<Expense>(
        `select * from public.expenses order by expense_date desc`
      ),
      query<{ expense_id: string }>(`select * from public.expense_shares`),
      query<Category>(`select * from public.categories`),
      query<Vendor>(`select * from public.vendors`),
      query<Recurring>(`select * from public.recurring where is_active = true`),
      query<AppUser>(`select id, name, email, is_core_member, is_admin from public.users order by name`),
      one<{ name: string }>(`select name from public.users where id = $1`, [
        session.sub,
      ]),
      getCachedUsdSellRate(),
      loadLedger(),
    ]);

  const expenses = exp.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];
  const categories = cats as Category[];
  const vendors = vends as Vendor[];
  const recurring = recs as Recurring[];
  const users = team as AppUser[];
  const individualSpending = computeIndividualSpending(users, expenses);
  const assignedTotal = individualSpending.reduce((sum, row) => sum + row.assigned, 0);
  const founderExpenseTotal = sumMoney(
    expenses
      .filter((expense) => expense.funding_source !== "company_funds")
      .map((expense) => expense.amount_npr)
  );
  // Client payments are revenue; capital raises the balance without ever being
  // revenue. Both reach the balance, only one reaches "money in".
  const accountBalances = ledger.balances;
  const primaryAccountBalances = [
    accountBalances.find((item) => item.account.kind === "personal_custody"),
    accountBalances.find((item) => item.account.kind === "company_bank"),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const firstName = (me?.name ?? "there").split(" ")[0];

  // Totals come from lib/expense-summary, which the AI assistant uses too, so
  // the dashboard and the assistant always agree (exact to the paisa).
  const allTime = expenseTotals(expenses);
  const totalNpr = allTime.totalNpr;
  const usdForeign = allTime.usdAmount;

  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const thisMonth = expenseTotals(expenses, { from: monthStart }).totalNpr;

  const nextMonthStart = format(addMonths(startOfMonth(new Date()), 1), "yyyy-MM-dd");
  const nextMonthEnd = format(addMonths(startOfMonth(new Date()), 2), "yyyy-MM-dd");
  const projected = projectedRenewalsNpr(recurring, currentRate?.rate, nextMonthStart, nextMonthEnd);

  // ---- Donut: category share (top 4 + Other) ----
  const categoryTotals = new Map(
    groupExpenses(expenses, (e) => e.category_id).map((group) => [group.key, group.totalNpr])
  );
  const byCatAll = categories
    .map((c) => ({
      name: c.name,
      value: categoryTotals.get(c.id) ?? 0,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = byCatAll.slice(0, 4);
  const otherVal = sumMoney(byCatAll.slice(4).map((d) => d.value));
  const slices = otherVal > 0 ? [...top, { name: "Other", value: otherVal }] : top;

  // ---- Bars: last 6 months ----
  const months: { label: string; value: number; current: boolean }[] = [];
  for (let i = 5; i >= 0; i--) {
    const s = startOfMonth(addMonths(new Date(), -i));
    const from = format(s, "yyyy-MM-dd");
    const to = format(addMonths(s, 1), "yyyy-MM-dd");
    months.push({
      label: format(s, "MMM"),
      value: expenseTotals(expenses, { from, before: to }).totalNpr,
      current: i === 0,
    });
  }

  const recent = expenses.slice(0, 6);
  const vName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? "";
  const cName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "—";

  const pendingCount = expenses.filter((e) => e.conversion_status === "pending").length;

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title={`Good to see you, ${firstName}`}
        subtitle={`${format(new Date(), "EEEE, d MMMM yyyy")} · A complete view of Avernek's financial activity.`}
        action={currentRate ? (
          <div className="pill !py-1.5 !px-3 tnum">
            $1 = NPR {currentRate.rate.toFixed(2)}
            <span className="ml-1.5 opacity-60">NRB · {currentRate.rateDate.slice(5)}</span>
          </div>
        ) : undefined}
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Total spent" value={npr(totalNpr)} hint={usdForeign > 0 ? `Includes ${usd(usdForeign)} in USD` : "All recorded company costs"} emphasis icon="wallet" tone="accent" />
        <StatTile label="This month" value={npr(thisMonth)} hint={format(new Date(), "MMMM")} icon="calendar" tone="blue" />
        <StatTile label="Next month" value={npr(projected)} hint="Expected subscription renewals" icon="subscription" tone="amber" />
      </div>

      {pendingCount > 0 && (
        <div className="alert alert-warn mt-4">
          {pendingCount} expense{pendingCount > 1 ? "s" : ""} missing an exchange rate.{" "}
          <Link href="/expenses" className="underline">
            Fix
          </Link>
        </div>
      )}

      <div className="mt-6 mb-3">
        <SectionHeader
          title="Three lifetime ledgers"
          subtitle="Founder spending stays separate. The two company-money accounts independently show money in, money out, and what remains."
          action={<Link href="/funds" className="text-xs muted hover:opacity-80 transition-opacity">Open company money →</Link>}
        />
      </div>
      <div className="grid lg:grid-cols-3 gap-3">
        <LedgerCard
          title="Founder/team investment"
          subtitle="Pre-registration and later own-pocket spending by founders or team members."
          badge="Founder capital"
          moneyOut={npr(founderExpenseTotal)}
          outLabel="All-time founder money spent"
          note="No money-in or balance is calculated here. Every founder expense records the amount, payer, vendor/category, date, and purpose."
          icon="contribution"
          tone="accent"
        />
        {primaryAccountBalances.map((item) => {
          const personallyHeld = item.account.kind === "personal_custody";
          return (
            <LedgerCard
              key={item.account.id}
              title={personallyHeld ? "Swornim Global IME" : "Avernek company Global IME"}
              subtitle={personallyHeld ? "Company-owned money from clients who do not need a VAT bill." : "Official company account for clients who need a VAT bill."}
              badge={personallyHeld ? "Non-VAT company money" : "VAT company money"}
              moneyIn={formatIncomeMoney(item.revenue + item.vatIn - item.tdsWithheld + item.transferredIn, item.account.currency)}
              moneyOut={formatIncomeMoney(item.spent + item.transferredOut + item.vatPaid, item.account.currency)}
              balance={formatIncomeMoney(item.balance, item.account.currency)}
              capitalIn={item.capitalIn > 0 ? formatIncomeMoney(item.capitalIn, item.account.currency) : undefined}
              note={personallyHeld ? "The account holder is Swornim, but every rupee in this ledger belongs to Avernek." : item.vatReserved > 0 ? `${formatIncomeMoney(item.vatReserved, item.account.currency)} of the balance is VAT owed to IRD — free to use: ${formatIncomeMoney(item.free, item.account.currency)}.` : "Income, expenses, and transfers remain separate from founder investment."}
              icon={personallyHeld ? "user" : "bank"}
              tone={personallyHeld ? "blue" : "green"}
            />
          );
        })}
      </div>

      <div className="card p-5 mt-4">
        <div className="mb-3">
          <SectionHeader title="Founder/team investment" subtitle="Pre-registration and own-pocket expenses only; company-money spending is excluded" action={
          <Link href="/expenses" className="text-xs muted hover:opacity-80 transition-opacity">
            View details →
          </Link>
          } />
        </div>
        <div className="divide-y" style={{ borderColor: "var(--line)" }}>
          {individualSpending.map(({ member, assigned, paid }, index) => (
            <Link
              key={member.id}
              href={`/expenses?person=${member.id}&basis=share`}
              className="list-row flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl"
              style={{ borderColor: "var(--line)" }}
            >
              <span className="pill !px-2 !py-0.5 tnum">#{index + 1}</span>
              <span className="min-w-0 flex-1 font-medium truncate">{member.name}</span>
              <span className="text-right">
                <span className="block tnum font-semibold">{npr(assigned)}</span>
                <span className="block text-xs muted tnum">paid {npr(paid)}</span>
              </span>
            </Link>
          ))}
          <div className="flex items-center justify-between pt-3 text-sm font-semibold">
            <span>Total founder/team investment</span>
            <span className="tnum">{npr(assignedTotal)}</span>
          </div>
        </div>
      </div>

      <DashboardCharts categories={slices} months={months} total={totalNpr} />

      {/* Latest */}
      <div className="card p-6 mt-4">
        <div className="mb-4">
          <SectionHeader title="Latest expenses" subtitle="Most recent company transactions" action={
          <Link href="/expenses" className="text-xs muted hover:opacity-80 transition-opacity">
            See all →
          </Link>
          } />
        </div>
        {recent.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-3">
            {recent.map((e) => (
              <div key={e.id} className="list-row flex items-center gap-3 text-sm px-2 py-2 -mx-2 rounded-xl">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {vName(e.vendor_id) || cName(e.category_id)}
                  </div>
                  <div className="text-xs muted">
                    {e.expense_date} · {cName(e.category_id)}
                  </div>
                </div>
                {e.currency === "USD" && (
                  <FxBadge source={e.fx_source} status={e.conversion_status} />
                )}
                <div className="tnum font-semibold">
                  {e.amount_npr != null ? npr(e.amount_npr) : usd(e.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Empty() {
  return (
    <EmptyState title="Nothing here yet" description="Add your first expense to unlock this financial view." />
  );
}
