import { query } from "@/lib/db";
import { PageHeader, StatTile } from "@/components/ui";
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
  const maxContribution = Math.max(...contributions.map((item) => item.assigned), 1);

  return (
    <>
      <PageHeader
        eyebrow="Ownership view"
        title="Investment contributions"
        subtitle="Founder/team money invested before registration or paid personally. Company operating money is excluded."
      />

      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatTile label="Attributed investment" value={npr(totalInvestment)} hint="Founder/team capital assigned" icon="contribution" tone="accent" />
        <StatTile label="Own-pocket cash paid" value={npr(totalCashPaid)} hint="Paid personally to vendors" icon="wallet" tone="green" />
      </div>

      <div className="card overflow-hidden divide-y" style={{ borderColor: "var(--line)" }}>
        {contributions.map(({ member, assigned, paid }) => (
          <div
            key={member.id}
            className="list-row p-4 md:px-5 flex items-center gap-4"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="avatar">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {member.name}
                {!member.is_core_member && (
                  <span className="pill ml-2">manual split</span>
                )}
              </div>
              <div className="text-xs muted">Cash paid to vendors: {npr(paid)}</div>
              <div className="progress-track mt-2 max-w-md"><div className="progress-fill" style={{ width: `${Math.max(3, assigned / maxContribution * 100)}%` }} /></div>
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
