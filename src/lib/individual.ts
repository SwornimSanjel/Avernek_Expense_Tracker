import type { AppUser, Expense } from "./types";

export interface IndividualSpending {
  member: AppUser;
  assigned: number;
  paid: number;
}

export function assignedShareNpr(
  expense: Expense,
  member: AppUser,
  users: AppUser[]
): number {
  if (expense.amount_npr == null) return 0;
  if (expense.expense_shares?.length) {
    return Number(
      expense.expense_shares.find((share) => share.user_id === member.id)?.amount_npr ?? 0
    );
  }
  const coreCount = Math.max(users.filter((user) => user.is_core_member).length, 1);
  return member.is_core_member ? Number(expense.amount_npr) / coreCount : 0;
}

export function assignedShareOriginal(
  expense: Expense,
  member: AppUser,
  users: AppUser[]
): number {
  if (expense.expense_shares?.length) {
    return Number(
      expense.expense_shares.find((share) => share.user_id === member.id)?.amount ?? 0
    );
  }
  const coreCount = Math.max(users.filter((user) => user.is_core_member).length, 1);
  return member.is_core_member ? Number(expense.amount) / coreCount : 0;
}

export function computeIndividualSpending(
  users: AppUser[],
  expenses: Expense[]
): IndividualSpending[] {
  return users
    .map((member) => ({
      member,
      assigned: expenses.reduce(
        (sum, expense) => sum + assignedShareNpr(expense, member, users),
        0
      ),
      paid: expenses.reduce(
        (sum, expense) =>
          sum +
          (expense.paid_by_user_id === member.id ? Number(expense.amount_npr ?? 0) : 0),
        0
      ),
    }))
    .sort((a, b) => b.assigned - a.assigned || b.paid - a.paid);
}
