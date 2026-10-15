import Link from "next/link";
import { query } from "@/lib/db";
import { Avatar, Kpi, Money, PageHeader, SectionHeader } from "@/components/ui";
import Icon from "@/components/Icons";
import { formatNumber } from "@/lib/format";
import type { AppUser, Category, Expense } from "@/lib/types";
import { assignedShareNpr, computeIndividualSpending } from "@/lib/individual";
import { USER_COLUMNS, partnersOf, personTone } from "@/lib/people";
import { monthLabel, nepalToday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function SettlementsPage() {
  const today = nepalToday();
  const [users, exp, shareRows, categories] = await Promise.all([
    query<AppUser>(`select ${USER_COLUMNS} from public.users order by name`),
    // Lifetime: every founder expense counts, whatever date it carries.
    query<Expense>(
      `select * from public.expenses
        where funding_source <> 'company_funds'
        order by expense_date desc`
    ),
    query<{ expense_id: string }>(`select * from public.expense_shares`),
    query<Category>(`select id, name, color, monthly_budget from public.categories`),
  ]);

  const expenses = exp.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter((share) => share.expense_id === expense.id),
  })) as Expense[];
  const partners = partnersOf(users);
  const contributions = computeIndividualSpending(users, expenses);
  const total = contributions.reduce((sum, row) => sum + row.assigned, 0);
  const cashPaid = contributions.reduce((sum, row) => sum + row.paid, 0);
  const rows = partners
    .map((partner) => ({ partner, ...(contributions.find((row) => row.member.id === partner.id) ?? { assigned: 0, paid: 0 }) }))
    .sort((a, b) => b.assigned - a.assigned);
  const partnerSum = rows.reduce((sum, row) => sum + row.assigned, 0);
  const otherAccounts = Math.max(0, total - partnerSum);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  // What each partner's money went into, top categories.
  const breakdown = rows.map(({ partner }) => {
    const byCategory = new Map<string, number>();
    let latest = "";
    for (const expense of expenses) {
      const share = assignedShareNpr(expense, partner, users);
      if (share <= 0) continue;
      if (expense.expense_date > latest && expense.expense_date <= today) latest = expense.expense_date;
      const name = expense.category_id ? categoryName.get(expense.category_id) ?? "Other" : "Other";
      byCategory.set(name, (byCategory.get(name) ?? 0) + share);
    }
    return {
      id: partner.id,
      latest: latest || null,
      top: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
    };
  });

  return (
    <>
      <PageHeader
        title="Partner contributions"
        subtitle="Money each partner put in from their own pocket — before registration or paid personally since. Company money is not counted here."
      />

      <div className="kpi-grid kpi-grid-3 mb-6">
        <Kpi label="Total invested" icon="contribution" tone="accent" value={<Money value={total} />} foot={`By ${partners.length} partners`} />
        <Kpi label="Cash paid to vendors" icon="wallet" tone="green" value={<Money value={cashPaid} />} foot="Who actually handed over the money" />
        <Kpi
          label="Largest contributor"
          icon="trendUp"
          tone="blue"
          value={<span className="text-[24px]">{rows[0]?.partner.name ?? "—"}</span>}
          foot={rows[0] && total ? `${Math.round((rows[0].assigned / total) * 100)}% of all founder money` : undefined}
        />
      </div>

      {/* share bar */}
      <div className="card p-5 mb-6 rise">
        <div className="flex items-center justify-between text-[14px] font-semibold mb-3">
          <span>Ownership of founder money</span>
          <span className="tnum">NPR {formatNumber(total)}</span>
        </div>
        <div className="stack-bar !h-4">
          {rows.map((row, index) => (
            <span key={row.partner.id} title={`${row.partner.name}: ${formatNumber(row.assigned)}`} style={{ width: `${total ? (row.assigned / total) * 100 : 0}%`, background: personTone(index) }} />
          ))}
          {otherAccounts > 0 && <span style={{ width: `${(otherAccounts / total) * 100}%`, background: "var(--muted-2)" }} />}
        </div>
        <div className="legend-inline mt-3">
          {rows.map((row, index) => (
            <span key={row.partner.id}>
              <span className="chart-swatch" style={{ background: personTone(index) }} />
              {row.partner.name} <strong className="tnum text-[var(--ink)]">{total ? Math.round((row.assigned / total) * 100) : 0}%</strong>
            </span>
          ))}
        </div>
      </div>

      <SectionHeader title="By partner" subtitle="Click a partner to see every expense their share covers." />
      <div className="grid lg:grid-cols-3 gap-4">
        {rows.map((row, index) => {
          const info = breakdown.find((item) => item.id === row.partner.id)!;
          return (
            <Link
              key={row.partner.id}
              href={`/expenses?person=${row.partner.id}&basis=share&period=all`}
              className="card card-interactive p-5 flex flex-col rise"
            >
              <div className="flex items-center gap-3">
                <Avatar name={row.partner.name} color={personTone(index)} size={46} round />
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold truncate">{row.partner.name}</div>
                  <div className="text-[13px] muted">{info.latest ? `Last on ${monthLabel(info.latest.slice(0, 7), "short")}` : "No spending yet"}</div>
                </div>
                <span className="pill">#{index + 1}</span>
              </div>
              <div className="mt-4 text-[13px] muted">Investment share</div>
              <div className="text-[28px] font-semibold tracking-tight leading-tight"><Money value={row.assigned} /></div>
              <div className="bar-track mt-3">
                <div className="bar-fill" style={{ width: `${total ? (row.assigned / total) * 100 : 0}%`, "--bar": personTone(index) } as React.CSSProperties} />
              </div>
              <div className="flex justify-between mt-2 text-[13px]">
                <span className="muted">{total ? Math.round((row.assigned / total) * 100) : 0}% of total</span>
                <span className="muted">Paid personally <strong className="tnum text-[var(--ink-2)]">{formatNumber(Math.round(row.paid))}</strong></span>
              </div>
              {info.top.length > 0 && (
                <div className="mt-4 pt-4 border-t space-y-2 flex-1">
                  {info.top.map(([name, value]) => (
                    <div key={name} className="flex items-center justify-between text-[13.5px]">
                      <span className="muted truncate">{name}</span>
                      <span className="tnum">{formatNumber(Math.round(value))}</span>
                    </div>
                  ))}
                </div>
              )}
              <span className="link-more mt-4">See expenses <Icon name="arrow" size={14} /></span>
            </Link>
          );
        })}
      </div>

      <p className="text-[13px] muted mt-5 max-w-3xl">
        A partner&apos;s share is attribution for company accounting. It does not create a reimbursement or personal debt, even when someone else paid the vendor.
        {otherAccounts > 0.009 ? ` NPR ${formatNumber(otherAccounts)} of older default splits sits with sign-in accounts and is counted in the total only.` : ""}
      </p>
    </>
  );
}
