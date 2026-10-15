import type { Ledger } from "@/lib/ledger";
import { expenseAmountFromAccount } from "@/lib/funds";
import { CAPITAL_INFLOW_LABELS, OTHER_INCOME_LABELS } from "@/lib/income";
import { bankAmount } from "@/lib/tax";
import type { Expense, MoneyAccount } from "@/lib/types";

/**
 * One line on a bank-style statement. Every movement of money — a client
 * payment, a company-paid cost, a transfer, a VAT deposit, a loan — becomes
 * dated events against an account, so any period can be replayed with an
 * opening balance, money in, money out and a closing balance.
 *
 * Founder-paid expenses never touch a company account; they sit on their own
 * "founder" ledger (spending only, no balance).
 */
export type StatementKind =
  | "client"
  | "other_income"
  | "capital"
  | "expense"
  | "founder"
  | "transfer"
  | "reimbursement"
  | "vat"
  | "loan"
  | "loan_back";

export type StatementEvent = {
  id: string;
  date: string;
  createdAt: string;
  /** Account id, or "founder" for own-pocket spending. */
  account: string;
  direction: "in" | "out";
  kind: StatementKind;
  title: string;
  detail: string;
  /** Always positive; `direction` gives the sign. */
  amount: number;
  currency: string;
  /** VAT inside an incoming amount (owed to IRD). */
  vat?: number;
  category?: string | null;
  client?: string | null;
  /** Transfers between two company accounts cancel out on an all-accounts view. */
  internal?: boolean;
  href?: string;
};

export type StatementAccount = {
  id: string;
  label: string;
  name: string;
  kind: MoneyAccount["kind"] | "founder";
  currency: string;
};

export function accountLabel(account: Pick<MoneyAccount, "kind" | "name">): string {
  if (account.kind === "company_bank") return "VAT account";
  if (account.kind === "personal_custody") return "Non-VAT account";
  return account.name;
}

export function statementAccounts(accounts: MoneyAccount[]): StatementAccount[] {
  const order = (kind: MoneyAccount["kind"]) => (kind === "company_bank" ? 0 : kind === "personal_custody" ? 1 : 2);
  return [...accounts]
    .sort((a, b) => order(a.kind) - order(b.kind))
    .map((account) => ({
      id: account.id,
      label: accountLabel(account),
      name: account.name,
      kind: account.kind,
      currency: account.currency,
    }));
}

export function buildStatementEvents({
  ledger,
  founderExpenses,
  clientNames,
  categoryNames,
  vendorNames,
}: {
  ledger: Ledger;
  founderExpenses: Expense[];
  clientNames: Map<string, string>;
  categoryNames: Map<string, string>;
  vendorNames: Map<string, string>;
}): StatementEvent[] {
  const accountById = new Map(ledger.accounts.map((account) => [account.id, account]));
  const label = (id: string | null | undefined) => {
    const account = id ? accountById.get(id) : undefined;
    return account ? accountLabel(account) : "Unassigned account";
  };
  const events: StatementEvent[] = [];

  for (const payment of ledger.payments) {
    if (!payment.money_account_id) continue;
    const client = clientNames.get(payment.agreement_id) ?? "Client";
    const what =
      payment.payment_for === "setup" ? "Setup fee" : payment.payment_for === "website" ? "Website" : "Monthly fee";
    events.push({
      id: `pay-${payment.id}`,
      date: payment.paid_on,
      createdAt: payment.created_at,
      account: payment.money_account_id,
      direction: "in",
      kind: "client",
      title: client,
      detail: `${what}${Number(payment.vat_amount) > 0 ? " · incl. VAT" : ""}${Number(payment.tds_amount) > 0 ? " · TDS withheld" : ""}`,
      amount: bankAmount(payment),
      currency: accountById.get(payment.money_account_id)?.currency ?? "NPR",
      vat: Number(payment.vat_amount ?? 0),
      client,
      href: `/income/${payment.agreement_id}`,
    });
  }

  for (const row of ledger.otherIncome) {
    events.push({
      id: `oth-${row.id}`,
      date: row.received_on,
      createdAt: row.created_at,
      account: row.money_account_id,
      direction: "in",
      kind: "other_income",
      title: row.description,
      detail: `${OTHER_INCOME_LABELS[row.category]}${row.source_name ? ` · ${row.source_name}` : ""}`,
      amount: bankAmount(row),
      currency: accountById.get(row.money_account_id)?.currency ?? "NPR",
      vat: Number(row.vat_amount ?? 0),
      client: row.source_name,
    });
  }

  for (const inflow of ledger.capitalInflows) {
    events.push({
      id: `cap-${inflow.id}`,
      date: inflow.received_on,
      createdAt: inflow.created_at,
      account: inflow.money_account_id,
      direction: "in",
      kind: "capital",
      title: CAPITAL_INFLOW_LABELS[inflow.inflow_type],
      detail: `${inflow.source_name ? `From ${inflow.source_name} · ` : ""}Not revenue`,
      amount: Number(inflow.amount),
      currency: accountById.get(inflow.money_account_id)?.currency ?? "NPR",
    });
  }

  for (const expense of ledger.expenses) {
    const account = accountById.get(expense.money_account_id ?? "");
    const category = expense.category_id ? categoryNames.get(expense.category_id) ?? null : null;
    const vendor = expense.vendor_id ? vendorNames.get(expense.vendor_id) : undefined;
    events.push({
      id: `exp-${expense.id}`,
      date: expense.expense_date,
      createdAt: expense.created_at,
      account: expense.money_account_id ?? "unassigned",
      direction: "out",
      kind: "expense",
      title: expense.note || vendor || category || "Company expense",
      detail: [vendor && expense.note ? vendor : null, category, expense.client].filter(Boolean).join(" · ") || "Company money",
      amount: account ? expenseAmountFromAccount(expense, account) : Number(expense.amount_npr ?? expense.amount),
      currency: account?.currency ?? expense.currency,
      category,
      client: expense.client,
      href: "/expenses",
    });
  }

  for (const expense of founderExpenses) {
    const category = expense.category_id ? categoryNames.get(expense.category_id) ?? null : null;
    const vendor = expense.vendor_id ? vendorNames.get(expense.vendor_id) : undefined;
    events.push({
      id: `fnd-${expense.id}`,
      date: expense.expense_date,
      createdAt: expense.created_at,
      account: "founder",
      direction: "out",
      kind: "founder",
      title: expense.note || vendor || category || "Founder-paid expense",
      detail: [vendor && expense.note ? vendor : null, category, expense.client].filter(Boolean).join(" · ") || "Founder money",
      amount: Number(expense.amount_npr ?? 0),
      currency: "NPR",
      category,
      client: expense.client,
      href: "/expenses?ledger=founder",
    });
  }

  for (const transfer of ledger.transfers) {
    const reimbursement = transfer.kind === "reimbursement";
    const base = {
      date: transfer.transfer_date,
      createdAt: transfer.created_at,
      kind: (reimbursement ? "reimbursement" : "transfer") as StatementKind,
      title: reimbursement ? (transfer.note ?? "Bill reimbursed").replace(/^Reimbursed:\s*/i, "Reimbursed · ") : transfer.note || "Transfer between accounts",
      internal: true,
    };
    events.push({
      ...base,
      id: `trf-out-${transfer.id}`,
      account: transfer.from_account_id,
      direction: "out",
      detail: `To ${label(transfer.to_account_id)}`,
      amount: Number(transfer.from_amount),
      currency: accountById.get(transfer.from_account_id)?.currency ?? "NPR",
    });
    events.push({
      ...base,
      id: `trf-in-${transfer.id}`,
      account: transfer.to_account_id,
      direction: "in",
      detail: `From ${label(transfer.from_account_id)}`,
      amount: Number(transfer.to_amount),
      currency: accountById.get(transfer.to_account_id)?.currency ?? "NPR",
    });
  }

  for (const row of ledger.taxPayments) {
    events.push({
      id: `vat-${row.id}`,
      date: row.paid_on,
      createdAt: row.created_at,
      account: row.money_account_id,
      direction: "out",
      kind: "vat",
      title: `VAT paid to IRD${row.period_label ? ` · ${row.period_label}` : ""}`,
      detail: row.reference ?? "Tax deposit",
      amount: Number(row.amount),
      currency: accountById.get(row.money_account_id)?.currency ?? "NPR",
      href: "/vat",
    });
  }

  for (const loan of ledger.loans) {
    events.push({
      id: `loan-${loan.id}`,
      date: loan.lent_on,
      createdAt: loan.created_at,
      account: loan.money_account_id,
      direction: "out",
      kind: "loan",
      title: `Lent to ${loan.borrower_name}`,
      detail: `${loan.note ? `${loan.note} · ` : ""}${loan.repaid_on ? "Paid back" : "Not paid back yet"}`,
      amount: Number(loan.amount),
      currency: accountById.get(loan.money_account_id)?.currency ?? "NPR",
      href: "/income",
    });
    if (loan.repaid_on && loan.repaid_to_account_id) {
      events.push({
        id: `loanback-${loan.id}`,
        date: loan.repaid_on,
        createdAt: loan.updated_at,
        account: loan.repaid_to_account_id,
        direction: "in",
        kind: "loan_back",
        title: `${loan.borrower_name} paid back`,
        detail: "Loan returned",
        amount: Number(loan.amount),
        currency: accountById.get(loan.repaid_to_account_id)?.currency ?? "NPR",
      });
    }
  }

  return events.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}
