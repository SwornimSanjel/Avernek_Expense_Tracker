import type { AppUser, Expense, Settlement } from "./types";

export interface Balance {
  user: AppUser;
  fronted: number; // total NPR this person paid out of pocket (unreimbursed)
  share: number; // their fair share of the shared pool
  net: number; // fronted - share (+ settlement adjustments). >0 = owed money, <0 = owes
}

export interface Debt {
  from: AppUser; // owes
  to: AppUser; // is owed
  amount: number;
}

/**
 * Expenses with named shares use those exact allocations, including guest shares.
 * Older/unallocated costs are split equally among core members for compatibility.
 * Settlements (reimbursements already paid) adjust the balances.
 */
export function computeBalances(
  users: AppUser[],
  expenses: Expense[],
  settlements: Settlement[]
): Balance[] {
  const core = users.filter((u) => u.is_core_member);
  const fronted = new Map<string, number>();
  const assigned = new Map<string, number>();
  for (const e of expenses) {
    if (e.is_reimbursed || e.amount_npr == null) continue;
    const amountNpr = Number(e.amount_npr);
    if (e.paid_by_user_id) {
      fronted.set(
        e.paid_by_user_id,
        (fronted.get(e.paid_by_user_id) ?? 0) + amountNpr
      );
    }

    if (e.expense_shares?.length) {
      for (const share of e.expense_shares) {
        if (share.amount_npr == null) continue;
        assigned.set(
          share.user_id,
          (assigned.get(share.user_id) ?? 0) + Number(share.amount_npr)
        );
      }
    } else {
      const perCore = amountNpr / Math.max(core.length, 1);
      for (const member of core) {
        assigned.set(member.id, (assigned.get(member.id) ?? 0) + perCore);
      }
    }
  }

  const net = new Map<string, number>();
  for (const u of users) {
    const paid = fronted.get(u.id) ?? 0;
    const share = assigned.get(u.id) ?? 0;
    net.set(u.id, paid - share);
  }
  // Apply settlements: `from` paid `to`, so from's debt shrinks, to's credit shrinks.
  for (const s of settlements) {
    net.set(s.from_user_id, (net.get(s.from_user_id) ?? 0) + Number(s.amount_npr));
    net.set(s.to_user_id, (net.get(s.to_user_id) ?? 0) - Number(s.amount_npr));
  }

  return users.map((u) => ({
    user: u,
    fronted: fronted.get(u.id) ?? 0,
    share: assigned.get(u.id) ?? 0,
    net: round2(net.get(u.id) ?? 0),
  }));
}

/** Greedy minimal set of "A pays B" transfers that clears all balances. */
export function simplifyDebts(balances: Balance[]): Debt[] {
  const debtors = balances
    .filter((b) => b.net < -0.5)
    .map((b) => ({ u: b.user, amt: -b.net }))
    .sort((a, b) => b.amt - a.amt);
  const creditors = balances
    .filter((b) => b.net > 0.5)
    .map((b) => ({ u: b.user, amt: b.net }))
    .sort((a, b) => b.amt - a.amt);

  const debts: Debt[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    debts.push({ from: debtors[i].u, to: creditors[j].u, amount: round2(pay) });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < 0.5) i++;
    if (creditors[j].amt < 0.5) j++;
  }
  return debts;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
