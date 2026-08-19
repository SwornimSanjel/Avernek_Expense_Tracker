import type {
  Expense,
  IncomePayment,
  MoneyAccount,
  MoneyTransfer,
} from "@/lib/types";

export type MoneyAccountBalance = {
  account: MoneyAccount;
  received: number;
  spent: number;
  transferredIn: number;
  transferredOut: number;
  balance: number;
};

/**
 * Return the amount that actually left the selected money account.
 * A USD vendor charge can be paid by an NPR bank account; in that case the
 * frozen actual/converted NPR amount is the bank-ledger debit.
 */
export function expenseAmountFromAccount(
  expense: Expense,
  account: MoneyAccount
) {
  if (expense.currency === account.currency) return Number(expense.amount);
  if (account.currency === "NPR" && expense.amount_npr != null) {
    return Number(expense.amount_npr);
  }
  return 0;
}

export function computeMoneyAccountBalances(
  accounts: MoneyAccount[],
  payments: IncomePayment[],
  expenses: Expense[],
  transfers: MoneyTransfer[]
): MoneyAccountBalance[] {
  return accounts.map((account) => {
    const received = payments
      .filter((payment) => payment.money_account_id === account.id)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const spent = expenses
      .filter(
        (expense) =>
          expense.funding_source === "company_funds" &&
          expense.money_account_id === account.id
      )
      .reduce((sum, expense) => sum + expenseAmountFromAccount(expense, account), 0);
    const transferredIn = transfers
      .filter((transfer) => transfer.to_account_id === account.id)
      .reduce((sum, transfer) => sum + Number(transfer.to_amount), 0);
    const transferredOut = transfers
      .filter((transfer) => transfer.from_account_id === account.id)
      .reduce((sum, transfer) => sum + Number(transfer.from_amount), 0);

    return {
      account,
      received,
      spent,
      transferredIn,
      transferredOut,
      balance: received + transferredIn - spent - transferredOut,
    };
  });
}

export function moneyAccountKindLabel(account: MoneyAccount) {
  if (account.kind === "company_bank") return "Official company account · VAT receipts";
  if (account.kind === "personal_custody") return "Swornim-held account · non-VAT receipts · company-owned money";
  if (account.kind === "digital_wallet") return "Digital wallet / prepaid balance";
  return "Company cash";
}
