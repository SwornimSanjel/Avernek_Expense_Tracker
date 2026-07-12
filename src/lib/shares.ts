import type { ExpenseShare } from "./types";

export interface ShareInput {
  userId: string;
  amount: number;
}

export function readShareInputs(formData: FormData): ShareInput[] {
  const userIds = formData.getAll("share_user_id").map(String);
  const amounts = formData.getAll("share_amount").map((value) => Number(value));
  const seen = new Set<string>();

  return userIds.map((userId, index) => {
    const amount = amounts[index];
    if (!userId || seen.has(userId)) throw new Error("Choose each person only once.");
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Every selected person needs a valid share amount.");
    }
    seen.add(userId);
    return { userId, amount };
  });
}

export function validateShareTotal(shares: ShareInput[], total: number) {
  if (shares.length === 0) return;
  const allocated = shares.reduce((sum, share) => sum + share.amount, 0);
  if (Math.abs(allocated - total) > 0.01) {
    throw new Error(
      `Shares must add up to the total (${total.toFixed(2)}). Currently allocated ${allocated.toFixed(2)}.`
    );
  }
}

export function toExpenseShareRows(
  expenseId: string,
  shares: ShareInput[],
  total: number,
  totalNpr: number | null
): Omit<ExpenseShare, "id">[] {
  let allocatedNpr = 0;
  return shares.map((share, index) => {
    const isLast = index === shares.length - 1;
    const amountNpr =
      totalNpr == null
        ? null
        : total === 0
          ? 0
          : isLast
            ? round2(totalNpr - allocatedNpr)
            : round2((totalNpr * share.amount) / total);
    if (amountNpr != null) allocatedNpr += amountNpr;
    return {
      expense_id: expenseId,
      user_id: share.userId,
      amount: share.amount,
      amount_npr: amountNpr,
    };
  });
}

export function billingMonthDate(value: FormDataEntryValue | null): string | null {
  const month = String(value ?? "");
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
