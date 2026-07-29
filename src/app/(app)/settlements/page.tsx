import { query } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { npr } from "@/lib/format";
import type { AppUser, Expense } from "@/lib/types";
import { computeIndividualSpending } from "@/lib/individual";

export const dynamic = "force-dynamic";

export default async function SettlementsPage() {
  const [team, exp, shareRows] = await Promise.all([
    query<AppUser>(`select id, name, email, is_core_member, is_admin from public.users order by name`),
    query<Expense>(`select * from public.expenses`),
    query<{ expense_id: string }>(`select * from public.expense_shares`),
  ]);

  const users = team as AppUser[];
  const expenses = exp.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];
  const contributions = computeIndividualSpending(users, expenses);
  const totalInvestment = contributions.reduce(
    (total, contribution) => total + contribution.assigned,
    0
  );
  const totalCashPaid = contributions.reduce(
    (total, contribution) => total + contribution.paid,
    0
  );

  return (
    <>
      <PageHeader
        title="Investment contributions"
        subtitle="Shares record each person’s investment in Avernek—not money they owe another person."
      />

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card p-5">
          <div className="text-xs muted">Attributed company investment</div>
          <div className="tnum text-xl font-bold mt-1">{npr(totalInvestment)}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs muted">Cash paid to vendors</div>
          <div className="tnum text-xl font-bold mt-1">{npr(totalCashPaid)}</div>
        </div>
      </div>

      <div className="card divide-y" style={{ borderColor: "var(--line)" }}>
        {contributions.map(({ member, assigned, paid }) => (
          <div
            key={member.id}
            className="p-4 flex items-center justify-between"
            style={{ borderColor: "var(--line)" }}
          >
            <div>
              <div className="font-medium">
                {member.name}
                {!member.is_core_member && (
                  <span className="pill ml-2">manual split</span>
                )}
              </div>
              <div className="text-xs muted">Cash paid to vendors: {npr(paid)}</div>
            </div>
            <div className="text-right">
              <div className="tnum font-semibold">{npr(assigned)}</div>
              <div className="text-xs muted">investment share</div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs muted mt-3">
        A person’s investment share is attribution for company accounting. It does
        not create a reimbursement or personal debt, even when someone else paid
        the vendor.
      </p>
    </>
  );
}
