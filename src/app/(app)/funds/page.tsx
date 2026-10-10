import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import Icon from "@/components/Icons";
import AddMoneyAccount from "@/components/AddMoneyAccount";
import AddMoneyTransfer from "@/components/AddMoneyTransfer";
import AddAccountFunds from "@/components/AddAccountFunds";
import AddOtherIncome from "@/components/AddOtherIncome";
import {
  AddCompanyBill,
  ConfirmDelete,
  PayVat,
  ReimburseBill,
} from "@/components/VatBillsActions";
import {
  accountShortName,
  expenseAmountFromAccount,
  moneyAccountKindLabel,
} from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import { CAPITAL_INFLOW_LABELS, OTHER_INCOME_LABELS, formatIncomeMoney, formatServiceDate } from "@/lib/income";
import {
  deleteCompanyBill,
  deleteMoneyTransfer,
  deleteTaxPayment,
} from "./actions";
import type { Currency, Expense, IncomeAgreement } from "@/lib/types";

export const dynamic = "force-dynamic";

function totalsLabel(values: Map<string, number>) {
  const entries = [...values.entries()].filter(([, amount]) => Math.abs(amount) > 0.001);
  if (!entries.length) return "NPR 0";
  return entries.map(([currency, amount]) => formatIncomeMoney(amount, currency)).join(" · ");
}

function addTotal(map: Map<string, number>, currency: Currency, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

export default async function FundsPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const [ledger, founderRows, agreements] = await Promise.all([
    loadLedger(),
    query<Pick<Expense, "amount_npr">>(
      `select amount_npr from public.expenses where funding_source <> 'company_funds'`
    ),
    query<Pick<IncomeAgreement, "id" | "client_name">>(`select id, client_name from public.income_agreements`),
  ]);
  const {
    accounts,
    payments,
    expenses: companyExpenses,
    transfers,
    capitalInflows,
    otherIncome,
    taxPayments,
    balances,
    tax,
    billStatuses,
  } = ledger;
  const founderSpent = founderRows.reduce((total, row) => total + Number(row.amount_npr ?? 0), 0);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const clientById = new Map(agreements.map((agreement) => [agreement.id, agreement.client_name]));
  const primaryBalances = [
    balances.find((item) => item.account.kind === "company_bank"),
    balances.find((item) => item.account.kind === "personal_custody"),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const otherBalances = balances.filter((item) => !primaryBalances.includes(item));

  const revenue = new Map<string, number>();
  const held = new Map<string, number>();
  const free = new Map<string, number>();
  const capitalIn = new Map<string, number>();
  balances.forEach((item) => {
    addTotal(revenue, item.account.currency, item.revenue);
    addTotal(held, item.account.currency, item.balance);
    addTotal(free, item.account.currency, item.free);
    addTotal(capitalIn, item.account.currency, item.capitalIn);
  });
  const pendingBills = billStatuses.filter((item) => item.pending > 0);
  const pendingTotal = pendingBills.reduce((sum, item) => sum + item.pending, 0);
  const vatRoom = Math.max(0, primaryBalances.find((item) => item.account.kind === "company_bank")?.free ?? 0);

  const activity = [
    ...payments
      .filter((payment) => payment.money_account_id)
      .map((payment) => ({
        key: `payment-${payment.id}`,
        date: payment.paid_on,
        createdAt: payment.created_at,
        kind: "income" as const,
        title: `${clientById.get(payment.agreement_id) ?? "Client"} payment`,
        detail: `${accountShortName(accountById.get(payment.money_account_id!))}${Number(payment.vat_amount) > 0 ? ` · incl. VAT ${formatIncomeMoney(Number(payment.vat_amount), "NPR")}` : ""}${Number(payment.tds_amount) > 0 ? ` · TDS ${formatIncomeMoney(Number(payment.tds_amount), "NPR")} withheld` : ""}`,
        amount: bankAmount(payment),
        currency: accountById.get(payment.money_account_id!)?.currency ?? "NPR",
      })),
    ...otherIncome.map((row) => ({
      key: `other-${row.id}`,
      date: row.received_on,
      createdAt: row.created_at,
      kind: "income" as const,
      title: row.description,
      detail: `${OTHER_INCOME_LABELS[row.category]} · ${accountShortName(accountById.get(row.money_account_id))}${row.source_name ? ` · from ${row.source_name}` : ""}`,
      amount: bankAmount(row),
      currency: accountById.get(row.money_account_id)?.currency ?? "NPR",
    })),
    ...companyExpenses.map((expense) => {
      const account = accountById.get(expense.money_account_id ?? "");
      return {
        key: `expense-${expense.id}`,
        date: expense.expense_date,
        createdAt: expense.created_at,
        kind: "expense" as const,
        title: expense.note || expense.client || "Company-funded expense",
        detail: accountShortName(account),
        amount: account ? expenseAmountFromAccount(expense, account) : Number(expense.amount),
        currency: account?.currency ?? expense.currency,
      };
    }),
    ...taxPayments.map((row) => ({
      key: `tax-${row.id}`,
      date: row.paid_on,
      createdAt: row.created_at,
      kind: "expense" as const,
      title: `VAT paid to IRD${row.period_label ? ` · ${row.period_label}` : ""}`,
      detail: accountShortName(accountById.get(row.money_account_id)),
      amount: Number(row.amount),
      currency: accountById.get(row.money_account_id)?.currency ?? "NPR",
    })),
    ...capitalInflows.map((inflow) => ({
      key: `capital-${inflow.id}`,
      date: inflow.received_on,
      createdAt: inflow.created_at,
      kind: "capital" as const,
      title: CAPITAL_INFLOW_LABELS[inflow.inflow_type],
      detail: `${accountShortName(accountById.get(inflow.money_account_id))}${inflow.source_name ? ` · from ${inflow.source_name}` : ""} · not income`,
      amount: Number(inflow.amount),
      currency: accountById.get(inflow.money_account_id)?.currency ?? "NPR",
    })),
    ...transfers.map((transfer) => ({
      key: `transfer-${transfer.id}`,
      date: transfer.transfer_date,
      createdAt: transfer.created_at,
      kind: "transfer" as const,
      title: transfer.kind === "reimbursement" ? `Reimbursement · ${transfer.note ?? "bill"}` : transfer.note || "Account transfer",
      detail: `${accountShortName(accountById.get(transfer.from_account_id))} → ${accountShortName(accountById.get(transfer.to_account_id))}`,
      amount: Number(transfer.from_amount),
      currency: accountById.get(transfer.from_account_id)?.currency ?? "NPR",
      toAmount: Number(transfer.to_amount),
      toCurrency: accountById.get(transfer.to_account_id)?.currency ?? "NPR",
    })),
  ].sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));

  return (
    <>
      <PageHeader
        eyebrow="Company treasury"
        title="Company money"
        subtitle="What is in each account, how much of it is VAT you must not touch, and which company bills still need reimbursing."
        action={canManage ? (
          <div className="flex flex-wrap gap-2">
            <AddOtherIncome accounts={accounts} />
            <AddAccountFunds accounts={accounts} />
            <AddMoneyTransfer balances={balances} />
            <AddMoneyAccount />
          </div>
        ) : undefined}
      />

      {/* ------------------------------------------------------------ accounts */}
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        {balances.length === 0 && (
          <div className="card md:col-span-2">
            <EmptyState title="No company-money accounts" description="Add the VAT and non-VAT accounts to begin." icon="bank" />
          </div>
        )}
        {[...primaryBalances, ...otherBalances].map((item) => (
          <div key={item.account.id} className="card p-5 account-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon name={item.account.kind === "personal_custody" ? "user" : "bank"} size={16} />
                  <strong>{accountShortName(item.account)}</strong>
                  <span className="pill">{item.account.currency}</span>
                </div>
                <div className="text-xs muted mt-1">{item.account.name}</div>
                <div className="text-[11px] muted mt-0.5">{moneyAccountKindLabel(item.account)}</div>
              </div>
            </div>
            <dl className="account-split mt-4">
              <div>
                <dt>In the account</dt>
                <dd style={{ color: item.balance < 0 ? "var(--red)" : undefined }}>
                  {formatIncomeMoney(item.balance, item.account.currency)}
                </dd>
              </div>
              <div>
                <dt>VAT · don&apos;t touch</dt>
                <dd style={{ color: item.vatReserved > 0 ? "var(--amber)" : undefined }}>
                  {formatIncomeMoney(item.vatReserved, item.account.currency)}
                </dd>
              </div>
              <div className="account-split-free">
                <dt>Free to use</dt>
                <dd>{formatIncomeMoney(item.free, item.account.currency)}</dd>
              </div>
            </dl>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-1.5 mt-4 text-xs">
              <Flow label="Income (excl. VAT)" value={formatIncomeMoney(item.revenue, item.account.currency)} />
              <Flow label="VAT collected" value={formatIncomeMoney(item.vatIn, item.account.currency)} />
              {item.tdsWithheld > 0 && <Flow label="TDS withheld by clients" value={`−${formatIncomeMoney(item.tdsWithheld, item.account.currency)}`} />}
              {item.capitalIn > 0 && <Flow label="Capital added · not income" value={formatIncomeMoney(item.capitalIn, item.account.currency)} />}
              <Flow label="Spent" value={`−${formatIncomeMoney(item.spent, item.account.currency)}`} />
              {item.vatPaid > 0 && <Flow label="VAT paid to IRD" value={`−${formatIncomeMoney(item.vatPaid, item.account.currency)}`} />}
              <Flow label="Moved in" value={formatIncomeMoney(item.transferredIn, item.account.currency)} />
              <Flow label="Moved out / reimbursed" value={`−${formatIncomeMoney(item.transferredOut, item.account.currency)}`} />
            </div>
          </div>
        ))}
      </div>

      {/* ----------------------------------------------------------- VAT & TDS */}
      <div className="mb-6">
        <SectionHeader
          title="VAT & TDS"
          subtitle="VAT you collected is the government's money. TDS clients withheld is a credit against Avernek's income tax."
          action={canManage ? <PayVat balances={balances} vatOwed={tax.vatOwed} /> : undefined}
        />
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3 mt-3">
          <StatTile label="VAT collected" value={formatIncomeMoney(tax.outputVat, "NPR")} hint="13% charged on VAT bills to clients" icon="receipt" tone="blue" />
          <StatTile label="Input VAT from bills" value={`−${formatIncomeMoney(tax.inputVat, "NPR")}`} hint="VAT inside bills in Avernek's name" icon="receipt" tone="green" />
          <StatTile label="VAT paid to IRD" value={`−${formatIncomeMoney(tax.vatDeposited, "NPR")}`} hint="Deposits recorded so far" icon="bank" tone="accent" />
          <StatTile
            label="VAT still owed"
            value={formatIncomeMoney(tax.vatOwed, "NPR")}
            hint={tax.vatCarryForward > 0 ? `${formatIncomeMoney(tax.vatCarryForward, "NPR")} input VAT to carry forward` : "Kept aside in the VAT account · estimate"}
            emphasis
            icon="clock"
            tone="amber"
          />
          <StatTile label="TDS credit" value={formatIncomeMoney(tax.tdsCredit, "NPR")} hint="Withheld by clients · claim in income tax" icon="contribution" tone="green" />
        </div>
        {taxPayments.length > 0 && (
          <div className="card mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
            {taxPayments.map((row) => (
              <div key={row.id} className="px-4 py-3 flex items-center gap-3 text-sm" style={{ borderColor: "var(--line)" }}>
                <span className="flex-1 min-w-0 truncate">
                  VAT paid{row.period_label ? ` · ${row.period_label}` : ""}
                  <span className="muted text-xs"> · {formatServiceDate(row.paid_on)}{row.reference ? ` · ${row.reference}` : ""}</span>
                </span>
                <strong className="tnum">{formatIncomeMoney(Number(row.amount), "NPR")}</strong>
                {canManage && <ConfirmDelete id={row.id} action={deleteTaxPayment} message="Delete this VAT payment record?" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------- bills */}
      <div className="mb-6">
        <SectionHeader
          title="Company bills to reimburse"
          subtitle={
            pendingTotal > 0
              ? `${formatIncomeMoney(pendingTotal, "NPR")} still to pay back · ${formatIncomeMoney(vatRoom, "NPR")} can be used from the VAT account right now`
              : "Bills in Avernek's name (lawyer, rent…) that were paid first from another account."
          }
          action={canManage ? (
            <div className="flex flex-wrap gap-2">
              <AddCompanyBill compact />
              <ReimburseBill bills={billStatuses} balances={balances} compact />
            </div>
          ) : undefined}
        />
        <div className="card mt-3 overflow-hidden">
          {billStatuses.length === 0 && (
            <EmptyState
              title="No bills yet"
              description="Add a bill issued in Avernek's name, then reimburse it from the VAT account when there is room."
              icon="receipt"
            />
          )}
          {billStatuses.map((item) => (
            <div key={item.bill.id} className="bill-row">
              <div className="bill-row-main">
                <div className="min-w-0">
                  <div className="font-medium truncate">{item.bill.description}</div>
                  <div className="text-xs muted mt-0.5 truncate">
                    {formatServiceDate(item.bill.bill_date)}
                    {item.bill.vendor_name ? ` · ${item.bill.vendor_name}` : ""}
                    {item.bill.bill_number ? ` · bill ${item.bill.bill_number}` : ""}
                    {item.bill.paid_by ? ` · paid by ${item.bill.paid_by}` : ""}
                  </div>
                </div>
                <dl className="bill-row-figures">
                  <div><dt>Bill</dt><dd>{formatIncomeMoney(Number(item.bill.total_amount), "NPR")}</dd></div>
                  <div><dt>VAT in it</dt><dd>{formatIncomeMoney(Number(item.bill.vat_amount), "NPR")}</dd></div>
                  <div><dt>Paid back</dt><dd style={{ color: "var(--green)" }}>{formatIncomeMoney(item.reimbursed, "NPR")}</dd></div>
                  <div><dt>Pending</dt><dd style={{ color: item.pending > 0 ? "var(--amber)" : "var(--green)" }}>{item.pending > 0 ? formatIncomeMoney(item.pending, "NPR") : "Done"}</dd></div>
                </dl>
                {canManage && (
                  <div className="flex items-center gap-1 justify-end">
                    {item.pending > 0 && <ReimburseBill bills={billStatuses} balances={balances} billId={item.bill.id} />}
                    <AddCompanyBill bill={item.bill} />
                    {item.reimbursements.length === 0 && (
                      <ConfirmDelete id={item.bill.id} action={deleteCompanyBill} message="Delete this bill?" />
                    )}
                  </div>
                )}
              </div>
              {item.reimbursements.length > 0 && (
                <div className="bill-row-history">
                  {item.reimbursements.map((transfer) => (
                    <div key={transfer.id} className="flex items-center gap-3 text-xs">
                      <span className="flex-1 min-w-0 truncate muted">
                        {formatServiceDate(transfer.transfer_date)} · {accountShortName(accountById.get(transfer.from_account_id))} →{" "}
                        {accountShortName(accountById.get(transfer.to_account_id))}
                      </span>
                      <strong className="tnum">{formatIncomeMoney(Number(transfer.from_amount), "NPR")}</strong>
                      {canManage && (
                        <ConfirmDelete id={transfer.id} action={deleteMoneyTransfer} message="Delete this reimbursement? The money goes back to the VAT account." />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------- totals */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <StatTile label="Income in (excl. VAT)" value={totalsLabel(revenue)} hint="Clients + income without a client" icon="income" tone="green" />
        <StatTile label="Company money held" value={totalsLabel(held)} hint="Everything in the accounts, VAT included" emphasis icon="wallet" tone="accent" />
        <StatTile label="Free to use" value={totalsLabel(free)} hint="Held minus VAT kept aside" icon="wallet" tone="green" />
        <StatTile label="Founder money spent" value={formatIncomeMoney(founderSpent, "NPR")} hint={`Own-pocket expenses · capital added ${totalsLabel(capitalIn)}`} icon="contribution" tone="blue" />
      </div>

      {/* --------------------------------------------------------- activity */}
      <div>
        <div className="mb-3"><SectionHeader title="Company-money activity" subtitle="Receipts (as they reached the bank), transfers, reimbursements, VAT payments and company-paid costs" /></div>
        <div className="card overflow-hidden divide-y" style={{ borderColor: "var(--line)" }}>
          {activity.length === 0 && <EmptyState title="No fund activity yet" description="Record a client payment or account transfer to begin." icon="wallet" />}
          {activity.slice(0, 100).map((item) => (
            <div key={item.key} className="list-row p-4 flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
              <div className="stat-icon" style={{ color: item.kind === "income" ? "var(--green)" : item.kind === "expense" ? "var(--red)" : item.kind === "capital" ? "#b8a0fb" : "var(--blue)" }}><Icon name={item.kind === "income" ? "income" : item.kind === "expense" ? "expense" : item.kind === "capital" ? "contribution" : "arrow"} size={16} /></div>
              <div className="min-w-0 flex-1"><div className="font-medium truncate">{item.title}</div><div className="text-xs muted mt-0.5 truncate">{formatServiceDate(item.date)} · {item.detail}</div></div>
              <div className="tnum text-right font-semibold" style={{ color: item.kind === "income" ? "var(--green)" : item.kind === "expense" ? "var(--red)" : item.kind === "capital" ? "#b8a0fb" : "var(--ink)" }}>
                {item.kind === "income" || item.kind === "capital" ? "+" : item.kind === "expense" ? "−" : ""}{formatIncomeMoney(item.amount, item.currency)}
                {item.kind === "transfer" && item.toCurrency !== item.currency && <div className="text-xs muted mt-0.5">→ {formatIncomeMoney(item.toAmount, item.toCurrency)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Flow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="muted">{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}
