import type {
  CapitalInflow,
  CompanyBill,
  Expense,
  IncomePayment,
  MoneyAccount,
  MoneyLoan,
  MoneyTransfer,
  OtherIncome,
  TaxPayment,
} from "@/lib/types";
import { round2 } from "@/lib/tax";

/**
 * `revenue` is earned money (bill amounts, excluding VAT) and `capitalIn` is
 * money the founders or a lender put in. `vatIn` is VAT collected for the
 * government and `tdsWithheld` is what clients kept back as TDS — it raised
 * revenue but never reached the bank. Nothing in the app may add capital or VAT
 * to revenue.
 */
export type MoneyAccountBalance = {
  account: MoneyAccount;
  /** Bill amounts excluding VAT, client agreements + other income. */
  revenue: number;
  /** Kept for older call sites: revenue that actually reached the bank. */
  received: number;
  vatIn: number;
  tdsWithheld: number;
  capitalIn: number;
  spent: number;
  transferredIn: number;
  transferredOut: number;
  reimbursedOut: number;
  vatPaid: number;
  /** Lent from this account and not paid back yet. */
  loanedOut: number;
  /** All money ever lent from this account (repaid or not). */
  lentOut: number;
  /** Loan repayments that came back into this account. */
  loanRepaidIn: number;
  balance: number;
  /** VAT still owed to IRD that sits in this account. Untouchable. */
  vatReserved: number;
  /** Balance minus the VAT reserve: what can actually be spent or reimbursed. */
  free: number;
};

export type TaxPosition = {
  outputVat: number;
  inputVat: number;
  vatDeposited: number;
  /** Output − input − deposited, never below zero. An estimate, not a return. */
  vatOwed: number;
  /** Input VAT larger than output VAT: carried forward, not refunded here. */
  vatCarryForward: number;
  tdsCredit: number;
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

export type LedgerInput = {
  accounts: MoneyAccount[];
  payments: IncomePayment[];
  expenses: Expense[];
  transfers: MoneyTransfer[];
  capitalInflows?: CapitalInflow[];
  otherIncome?: OtherIncome[];
  taxPayments?: TaxPayment[];
  bills?: CompanyBill[];
  loans?: MoneyLoan[];
};

function sumWhere<T>(rows: T[], keep: (row: T) => boolean, value: (row: T) => number) {
  return rows.reduce((total, row) => (keep(row) ? total + value(row) : total), 0);
}

export function computeTaxPosition({
  payments,
  otherIncome = [],
  taxPayments = [],
  bills = [],
}: Pick<LedgerInput, "payments" | "otherIncome" | "taxPayments" | "bills">): TaxPosition {
  const outputVat =
    sumWhere(payments, () => true, (row) => Number(row.vat_amount ?? 0)) +
    sumWhere(otherIncome, () => true, (row) => Number(row.vat_amount ?? 0));
  const inputVat = sumWhere(bills, () => true, (bill) => Number(bill.vat_amount ?? 0));
  const vatDeposited = sumWhere(taxPayments, (row) => row.tax_type === "vat", (row) => Number(row.amount));
  const net = outputVat - inputVat - vatDeposited;
  return {
    outputVat: round2(outputVat),
    inputVat: round2(inputVat),
    vatDeposited: round2(vatDeposited),
    vatOwed: round2(Math.max(0, net)),
    vatCarryForward: round2(Math.max(0, -net)),
    tdsCredit: round2(
      sumWhere(payments, () => true, (row) => Number(row.tds_amount ?? 0)) +
        sumWhere(otherIncome, () => true, (row) => Number(row.tds_amount ?? 0))
    ),
  };
}

export function computeMoneyAccountBalances(input: LedgerInput): MoneyAccountBalance[] {
  const {
    accounts,
    payments,
    expenses,
    transfers,
    capitalInflows = [],
    otherIncome = [],
    taxPayments = [],
    bills = [],
    loans = [],
  } = input;

  const rows = accounts.map((account) => {
    const mine = (id: string | null | undefined) => id === account.id;
    const revenue =
      sumWhere(payments, (p) => mine(p.money_account_id), (p) => Number(p.amount)) +
      sumWhere(otherIncome, (o) => mine(o.money_account_id), (o) => Number(o.amount));
    const vatIn =
      sumWhere(payments, (p) => mine(p.money_account_id), (p) => Number(p.vat_amount ?? 0)) +
      sumWhere(otherIncome, (o) => mine(o.money_account_id), (o) => Number(o.vat_amount ?? 0));
    const tdsWithheld =
      sumWhere(payments, (p) => mine(p.money_account_id), (p) => Number(p.tds_amount ?? 0)) +
      sumWhere(otherIncome, (o) => mine(o.money_account_id), (o) => Number(o.tds_amount ?? 0));
    const capitalIn = sumWhere(capitalInflows, (i) => mine(i.money_account_id), (i) => Number(i.amount));
    const spent = sumWhere(
      expenses,
      (e) => e.funding_source === "company_funds" && mine(e.money_account_id),
      (e) => expenseAmountFromAccount(e, account)
    );
    const transferredIn = sumWhere(transfers, (t) => mine(t.to_account_id), (t) => Number(t.to_amount));
    const transferredOut = sumWhere(transfers, (t) => mine(t.from_account_id), (t) => Number(t.from_amount));
    const reimbursedOut = sumWhere(
      transfers,
      (t) => t.kind === "reimbursement" && mine(t.from_account_id),
      (t) => Number(t.from_amount)
    );
    const vatPaid = sumWhere(taxPayments, (t) => mine(t.money_account_id), (t) => Number(t.amount));
    // A loan leaves the account when it is lent and comes back when repaid —
    // possibly into a different account. Neither side is revenue or expense.
    const lentOut = sumWhere(loans, (l) => mine(l.money_account_id), (l) => Number(l.amount));
    const loanRepaidIn = sumWhere(
      loans,
      (l) => Boolean(l.repaid_on) && mine(l.repaid_to_account_id),
      (l) => Number(l.amount)
    );
    const loanedOut = sumWhere(
      loans,
      (l) => !l.repaid_on && mine(l.money_account_id),
      (l) => Number(l.amount)
    );

    return {
      account,
      revenue,
      received: revenue - tdsWithheld,
      vatIn,
      tdsWithheld,
      capitalIn,
      spent,
      transferredIn,
      transferredOut,
      reimbursedOut,
      vatPaid,
      loanedOut: round2(loanedOut),
      lentOut: round2(lentOut),
      loanRepaidIn: round2(loanRepaidIn),
      balance: round2(
        revenue + vatIn - tdsWithheld + capitalIn + transferredIn - spent - transferredOut - vatPaid
          - lentOut + loanRepaidIn
      ),
      vatReserved: Math.max(0, vatIn - vatPaid),
      free: 0,
    };
  });

  // Input VAT from company bills lowers what is owed. Apply that credit to the
  // official VAT account first, which is where VAT is collected and paid from.
  let inputCredit = sumWhere(bills, () => true, (bill) => Number(bill.vat_amount ?? 0));
  const order = [...rows].sort(
    (a, b) => Number(b.account.kind === "company_bank") - Number(a.account.kind === "company_bank")
  );
  for (const row of order) {
    const used = Math.min(inputCredit, row.vatReserved);
    row.vatReserved = round2(row.vatReserved - used);
    inputCredit -= used;
  }
  for (const row of rows) row.free = round2(row.balance - row.vatReserved);
  return rows;
}

export type BillStatus = {
  bill: CompanyBill;
  reimbursed: number;
  pending: number;
  reimbursements: MoneyTransfer[];
};

export function summarizeBills(bills: CompanyBill[], transfers: MoneyTransfer[]): BillStatus[] {
  return bills.map((bill) => {
    const reimbursements = transfers.filter(
      (transfer) => transfer.kind === "reimbursement" && transfer.bill_id === bill.id
    );
    const reimbursed = reimbursements.reduce((sum, transfer) => sum + Number(transfer.from_amount), 0);
    return {
      bill,
      reimbursed: round2(reimbursed),
      pending: round2(Math.max(0, Number(bill.total_amount) - reimbursed)),
      reimbursements,
    };
  });
}

export function moneyAccountKindLabel(account: MoneyAccount) {
  if (account.kind === "company_bank") return "Official company account · VAT receipts";
  if (account.kind === "personal_custody") return "Swornim-held account · non-VAT receipts · company-owned money";
  if (account.kind === "digital_wallet") return "Digital wallet / prepaid balance";
  return "Company cash";
}

/** "VAT account" / "Non-VAT account" / the account's own name. */
export function accountShortName(account: MoneyAccount | undefined | null) {
  if (!account) return "Unassigned account";
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

export function capitalInflowTotals(
  inflows: CapitalInflow[],
  accounts: MoneyAccount[]
): Map<string, number> {
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currency]));
  const totals = new Map<string, number>();
  for (const inflow of inflows) {
    const currency = currencyByAccount.get(inflow.money_account_id) ?? "NPR";
    totals.set(currency, (totals.get(currency) ?? 0) + Number(inflow.amount));
  }
  return totals;
}
