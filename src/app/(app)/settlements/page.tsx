import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { npr } from "@/lib/format";
import { computeBalances, simplifyDebts } from "@/lib/settle";
import type { AppUser, Expense, Settlement } from "@/lib/types";
import { recordSettlement } from "./actions";
import SettlementRowActions from "@/components/SettlementRowActions";

export const dynamic = "force-dynamic";

export default async function SettlementsPage() {
  const supabase = await createClient();
  const [{ data: team }, { data: exp }, { data: shareRows }, { data: setl }] = await Promise.all([
    supabase.from("users").select("*").order("name"),
    supabase.from("expenses").select("*"),
    supabase.from("expense_shares").select("*"),
    supabase.from("settlements").select("*").order("settled_on", { ascending: false }),
  ]);

  const users = (team ?? []) as AppUser[];
  const expenses = (exp ?? []).map((expense) => ({
    ...expense,
    expense_shares: (shareRows ?? []).filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];
  const settlements = (setl ?? []) as Settlement[];

  const balances = computeBalances(users, expenses, settlements);
  const debts = simplifyDebts(balances);
  const uName = (id: string) => users.find((u) => u.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader
        title="Balances"
        subtitle="Named shares are exact; older unallocated costs split between core members."
      />

      {/* Suggested settlements */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold mb-3">To settle up</h2>
        {debts.length === 0 ? (
          <p className="muted text-sm">Everyone's square.</p>
        ) : (
          <ul className="space-y-2">
            {debts.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ border: "1px solid var(--line)" }}
              >
                <span>
                  <span className="font-medium">{d.from.name.split(" ")[0]}</span>
                  <span className="muted"> pays </span>
                  <span className="font-medium">{d.to.name.split(" ")[0]}</span>
                </span>
                <span className="tnum font-semibold">{npr(d.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Per-person balances */}
      <div className="card divide-y mb-4" style={{ borderColor: "var(--line)" }}>
        {balances.map((b) => (
          <div
            key={b.user.id}
            className="p-4 flex items-center justify-between"
            style={{ borderColor: "var(--line)" }}
          >
            <div>
              <div className="font-medium">
                {b.user.name}
                {!b.user.is_core_member && <span className="pill ml-2">guest</span>}
              </div>
              <div className="text-xs muted">
                fronted {npr(b.fronted)} · share {npr(b.share)}
              </div>
            </div>
            <div
              className="tnum font-semibold"
              style={{
                color:
                  b.net > 0.5
                    ? "var(--green)"
                    : b.net < -0.5
                    ? "var(--red)"
                    : "var(--muted)",
              }}
            >
              {b.net > 0.5
                ? `owed ${npr(b.net)}`
                : b.net < -0.5
                ? `owes ${npr(-b.net)}`
                : "square"}
            </div>
          </div>
        ))}
      </div>

      {/* Record a reimbursement */}
      <div className="card p-5">
        <h2 className="font-semibold mb-3">Record a reimbursement</h2>
        <form action={recordSettlement} className="flex flex-wrap items-end gap-2">
          <label className="text-xs muted">
            From
            <select name="from_user_id" className="input !w-auto mt-1">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs muted">
            To
            <select name="to_user_id" className="input !w-auto mt-1">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs muted">
            Amount (NPR)
            <input name="amount_npr" inputMode="decimal" className="input tnum !w-36 mt-1" />
          </label>
          <button className="btn btn-primary">Record</button>
        </form>
      </div>

      {settlements.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold muted mb-2">History</h3>
          <div className="card divide-y text-sm" style={{ borderColor: "var(--line)" }}>
            {settlements.map((s) => (
              <div
                key={s.id}
                className="p-3 flex items-center justify-between gap-3"
                style={{ borderColor: "var(--line)" }}
              >
                <span>
                  {uName(s.from_user_id)} → {uName(s.to_user_id)} · {s.settled_on}
                </span>
                <div className="flex items-center gap-2">
                  <span className="tnum">{npr(s.amount_npr)}</span>
                  <SettlementRowActions settlement={s} users={users} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
