import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, LedgerCard, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import Icon from "@/components/Icons";
import AddMoneyAccount from "@/components/AddMoneyAccount";
import AddMoneyTransfer from "@/components/AddMoneyTransfer";
import {
  computeMoneyAccountBalances,
  expenseAmountFromAccount,
  moneyAccountKindLabel,
} from "@/lib/funds";
import { formatIncomeMoney } from "@/lib/income";
import type {
  Currency,
  Expense,
  IncomeAgreement,
  IncomePayment,
  MoneyAccount,
  MoneyTransfer,
} from "@/lib/types";

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
  const [accounts, payments, expenses, transfers, agreements] = await Promise.all([
    query<MoneyAccount>(`select * from public.money_accounts where is_active = true order by currency, name`),
    query<IncomePayment>(`select * from public.income_payments order by paid_on desc, created_at desc`),
    query<Expense>(`select * from public.expenses order by expense_date desc, created_at desc`),
    query<MoneyTransfer>(`select * from public.money_transfers order by transfer_date desc, created_at desc`),
    query<IncomeAgreement>(`select * from public.income_agreements`),
  ]);
  const companyExpenses = expenses.filter((expense) => expense.funding_source === "company_funds");
  const founderSpent = expenses
    .filter((expense) => expense.funding_source !== "company_funds")
    .reduce((total, expense) => total + Number(expense.amount_npr ?? 0), 0);
  const balances = computeMoneyAccountBalances(accounts, payments, companyExpenses, transfers);
  const primaryBalances = [
    balances.find((item) => item.account.kind === "personal_custody"),
    balances.find((item) => item.account.kind === "company_bank"),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const agreementById = new Map(agreements.map((agreement) => [agreement.id, agreement]));
  const held = new Map<string, number>();
  const companyIn = new Map<string, number>();
  const companyOut = new Map<string, number>();
  const unassigned = new Map<string, number>();
  balances.forEach((item) => addTotal(held, item.account.currency, item.balance));
  payments.forEach((payment) => {
    const account = accountById.get(payment.money_account_id ?? "");
    const agreement = agreementById.get(payment.agreement_id);
    if (account) addTotal(companyIn, account.currency, Number(payment.amount));
    else if (agreement) addTotal(companyIn, agreement.currency, Number(payment.amount));
  });
  companyExpenses.forEach((expense) => {
    const account = accountById.get(expense.money_account_id ?? "");
    addTotal(
      companyOut,
      account?.currency ?? expense.currency,
      account ? expenseAmountFromAccount(expense, account) : Number(expense.amount)
    );
  });
  payments
    .filter((payment) => !payment.money_account_id)
    .forEach((payment) => {
      const agreement = agreementById.get(payment.agreement_id);
      if (agreement) addTotal(unassigned, agreement.currency, Number(payment.amount));
    });

  const activity = [
    ...payments
      .filter((payment) => payment.money_account_id)
      .map((payment) => ({
        key: `payment-${payment.id}`,
        date: payment.paid_on,
        createdAt: payment.created_at,
        kind: "income" as const,
        title: `${agreementById.get(payment.agreement_id)?.client_name ?? "Client"} payment`,
        detail: accountById.get(payment.money_account_id!)?.name ?? "Company account",
        amount: Number(payment.amount),
        currency: accountById.get(payment.money_account_id!)?.currency ?? "NPR",
      })),
    ...companyExpenses.map((expense) => {
      const account = accountById.get(expense.money_account_id ?? "");
      const crossCurrency = account && account.currency !== expense.currency;
      return {
        key: `expense-${expense.id}`,
        date: expense.expense_date,
        createdAt: expense.created_at,
        kind: "expense" as const,
        title: expense.note || expense.client || "Company-funded expense",
        detail: `${account?.name ?? "Unassigned account"}${crossCurrency ? ` · vendor charge ${formatIncomeMoney(Number(expense.amount), expense.currency)}` : ""}`,
        amount: account ? expenseAmountFromAccount(expense, account) : Number(expense.amount),
        currency: account?.currency ?? expense.currency,
      };
    }),
    ...transfers.map((transfer) => ({
      key: `transfer-${transfer.id}`,
      date: transfer.transfer_date,
      createdAt: transfer.created_at,
      kind: "transfer" as const,
      title: transfer.note || "Account transfer",
      detail: `${accountById.get(transfer.from_account_id)?.name ?? "Account"} → ${accountById.get(transfer.to_account_id)?.name ?? "Account"}`,
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
        subtitle="Balances for the two company-money accounts. Founder/team investment remains separate under Expenses and Contributions."
        action={canManage ? (
          <div className="flex gap-2"><AddMoneyAccount /><AddMoneyTransfer balances={balances} /></div>
        ) : undefined}
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <StatTile label="Founder money spent" value={formatIncomeMoney(founderSpent, "NPR")} hint="Pre-registration + later own-pocket expenses" emphasis icon="contribution" tone="accent" />
        <StatTile label="Company money in" value={totalsLabel(companyIn)} hint="All client receipts; transfers excluded" icon="income" tone="green" />
        <StatTile label="Company money out" value={totalsLabel(companyOut)} hint="Operating expenses; transfers excluded" icon="expense" tone="amber" />
        <StatTile label="Company money held" value={totalsLabel(held)} hint="Across Swornim Global IME, company Global IME, and wallets" emphasis icon="wallet" tone="green" />
      </div>

      {unassigned.size > 0 && (
        <div className="alert alert-warn mb-5">
          {totalsLabel(unassigned)} of legacy income has no receiving account. Assign or re-record it so account balances remain complete.
        </div>
      )}

      <div className="mb-6">
        <SectionHeader title="Three lifetime ledgers" subtitle="Founder spending is expense-only; both company-money bank accounts independently track in, out, transfers, and balance." />
        <div className="grid md:grid-cols-3 gap-3 mt-4">
          <LedgerCard
            title="Founder/team investment"
            subtitle="The original tracker: pre-registration and later own-pocket expenses."
            badge="Founder capital"
            moneyOut={formatIncomeMoney(founderSpent, "NPR")}
            outLabel="All-time founder money spent"
            note="No money-in or balance is calculated for founder capital. Open Expenses to see who paid each cost and exactly what it was spent on."
            icon="contribution"
            tone="accent"
          />
          {primaryBalances.map((item) => {
            const personallyHeld = item.account.kind === "personal_custody";
            return (
              <LedgerCard
                key={item.account.id}
                title={personallyHeld ? "Swornim Global IME" : "Avernek company Global IME"}
                subtitle={personallyHeld ? "Company money from non-VAT clients, held in Swornim's company-use account." : "Official company account for VAT-bill clients."}
                badge={personallyHeld ? "Non-VAT company money" : "VAT company money"}
                moneyIn={formatIncomeMoney(item.received + item.transferredIn, item.account.currency)}
                moneyOut={formatIncomeMoney(item.spent + item.transferredOut, item.account.currency)}
                balance={formatIncomeMoney(item.balance, item.account.currency)}
                note={personallyHeld ? "Legally held by Swornim, economically owned by Avernek. It never becomes founder investment." : "Official-account income and spending remain separate from both other ledgers."}
                icon={personallyHeld ? "user" : "bank"}
                tone={personallyHeld ? "blue" : "green"}
              />
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-3"><SectionHeader title="Account balances" subtitle="Income and transfers in, minus company-funded expenses and transfers out" /></div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {balances.length === 0 && <div className="card md:col-span-2"><EmptyState title="No company-money accounts" description="Add Swornim Global IME and the official Avernek Global IME account to begin." icon="bank" /></div>}
          {balances.map((item) => (
            <div key={item.account.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="stat-icon" style={{ color: item.account.kind === "personal_custody" ? "var(--blue)" : "#b8a0fb" }}><Icon name={item.account.kind === "personal_custody" ? "user" : "bank"} size={16} /></div>
                <span className="pill">{item.account.currency}</span>
              </div>
              <div className="mt-4 font-semibold">{item.account.name}</div>
              <div className="text-xs muted mt-1">{moneyAccountKindLabel(item.account)}{item.account.holder_name ? ` · holder ${item.account.holder_name}` : ""}</div>
              <div className="tnum text-2xl font-bold mt-5" style={{ color: item.balance < 0 ? "var(--red)" : "var(--ink)" }}>{formatIncomeMoney(item.balance, item.account.currency)}</div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                <div><span className="muted">Received</span><div className="tnum mt-0.5">{formatIncomeMoney(item.received + item.transferredIn, item.account.currency)}</div></div>
                <div><span className="muted">Used / moved</span><div className="tnum mt-0.5">{formatIncomeMoney(item.spent + item.transferredOut, item.account.currency)}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3"><SectionHeader title="Company-money activity" subtitle="Receipts, account movements, and costs paid from company balances" /></div>
        <div className="card overflow-hidden divide-y" style={{ borderColor: "var(--line)" }}>
          {activity.length === 0 && <EmptyState title="No fund activity yet" description="Record a client payment or account transfer to begin." icon="wallet" />}
          {activity.slice(0, 100).map((item) => (
            <div key={item.key} className="list-row p-4 flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
              <div className="stat-icon" style={{ color: item.kind === "income" ? "var(--green)" : item.kind === "expense" ? "var(--red)" : "var(--blue)" }}><Icon name={item.kind === "income" ? "income" : item.kind === "expense" ? "expense" : "arrow"} size={16} /></div>
              <div className="min-w-0 flex-1"><div className="font-medium truncate">{item.title}</div><div className="text-xs muted mt-0.5 truncate">{item.date} · {item.detail}</div></div>
              <div className="tnum text-right font-semibold" style={{ color: item.kind === "income" ? "var(--green)" : item.kind === "expense" ? "var(--red)" : "var(--ink)" }}>
                {item.kind === "income" ? "+" : item.kind === "expense" ? "−" : ""}{formatIncomeMoney(item.amount, item.currency)}
                {item.kind === "transfer" && <div className="text-xs muted mt-0.5">→ {formatIncomeMoney(item.toAmount, item.toCurrency)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
