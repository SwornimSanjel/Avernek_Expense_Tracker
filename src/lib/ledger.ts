import { query } from "@/lib/db";
import {
  computeMoneyAccountBalances,
  computeTaxPosition,
  summarizeBills,
  type LedgerInput,
} from "@/lib/funds";
import type {
  CapitalInflow,
  CompanyBill,
  Expense,
  IncomePayment,
  MoneyAccount,
  MoneyTransfer,
  OtherIncome,
  TaxPayment,
} from "@/lib/types";

/**
 * Every row that moves a company-money balance, loaded once. Pages and server
 * actions share this so a balance shown on screen and a balance checked before
 * a transfer can never be computed two different ways.
 */
export async function loadLedger() {
  const [accounts, payments, expenses, transfers, capitalInflows, otherIncome, taxPayments, bills] =
    await Promise.all([
      query<MoneyAccount>(`select * from public.money_accounts where is_active = true order by currency, name`),
      query<IncomePayment>(`select * from public.income_payments order by paid_on desc, created_at desc`),
      query<Expense>(
        `select * from public.expenses where funding_source = 'company_funds'
          order by expense_date desc, created_at desc`
      ),
      query<MoneyTransfer>(`select * from public.money_transfers order by transfer_date desc, created_at desc`),
      query<CapitalInflow>(`select * from public.capital_inflows order by received_on desc, created_at desc`),
      query<OtherIncome>(`select * from public.other_income order by received_on desc, created_at desc`),
      query<TaxPayment>(`select * from public.tax_payments order by paid_on desc, created_at desc`),
      query<CompanyBill>(`select * from public.company_bills order by bill_date desc, created_at desc`),
    ]);

  const input: LedgerInput = {
    accounts,
    payments,
    expenses,
    transfers,
    capitalInflows,
    otherIncome,
    taxPayments,
    bills,
  };

  return {
    ...input,
    capitalInflows,
    otherIncome,
    taxPayments,
    bills,
    balances: computeMoneyAccountBalances(input),
    tax: computeTaxPosition(input),
    billStatuses: summarizeBills(bills, transfers),
  };
}

export type Ledger = Awaited<ReturnType<typeof loadLedger>>;
