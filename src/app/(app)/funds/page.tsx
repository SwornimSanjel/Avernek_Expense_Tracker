import Link from "next/link";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { Callout, EmptyState, Money, PageHeader, SectionHeader } from "@/components/ui";
import Icon from "@/components/Icons";
import AddMoneyAccount from "@/components/AddMoneyAccount";
import AddMoneyTransfer from "@/components/AddMoneyTransfer";
import AddAccountFunds from "@/components/AddAccountFunds";
import StatementView from "@/components/StatementView";
import { loadStatement } from "@/lib/statement-data";
import { accountLabel } from "@/lib/statement";
import { formatNumber } from "@/lib/format";
import { nepalToday } from "@/lib/dates";
import type { MoneyAccountBalance } from "@/lib/funds";

export const dynamic = "force-dynamic";

export default async function FundsPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const today = nepalToday();
  const { ledger, events, accounts } = await loadStatement();
  const { balances, tax, billStatuses } = ledger;

  const order = (kind: string) => (kind === "company_bank" ? 0 : kind === "personal_custody" ? 1 : 2);
  const sorted = [...balances].sort((a, b) => order(a.account.kind) - order(b.account.kind));
  const held = balances.reduce((sum, item) => sum + item.balance, 0);
  const free = balances.reduce((sum, item) => sum + item.free, 0);
  const reserved = balances.reduce((sum, item) => sum + item.vatReserved, 0);
  const lent = balances.reduce((sum, item) => sum + item.loanedOut, 0);
  const pendingBills = billStatuses.reduce((sum, item) => sum + item.pending, 0);
  const total = Math.max(free + reserved + lent, 1);

  return (
    <>
      <PageHeader
        title="Company money"
        subtitle="What is in each account, how much of it is VAT, and every movement — month by month."
        action={
          canManage ? (
            <>
              <AddMoneyAccount />
              <AddAccountFunds accounts={ledger.accounts} />
              <AddMoneyTransfer balances={balances} />
            </>
          ) : undefined
        }
      />

      {/* position */}
      <div className="card p-6 dot-pattern rise">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[13.5px] muted">Company money held</div>
            <div className="text-[36px] font-semibold tracking-tight leading-tight mt-1"><Money value={held} /></div>
            <div className="text-[13.5px] muted mt-1">Across {balances.length} account{balances.length === 1 ? "" : "s"} · VAT included</div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right">
            <Figure label="Free to use" value={free} tone="var(--green)" />
            <Figure label="VAT for IRD" value={reserved} tone="var(--amber)" />
            <Figure label="Lent out" value={lent} tone="var(--blue)" />
          </div>
        </div>
        <div className="stack-bar !h-3 mt-5">
          <span style={{ width: `${(Math.max(free, 0) / total) * 100}%`, background: "var(--green)" }} />
          <span style={{ width: `${(reserved / total) * 100}%`, background: "var(--amber)" }} />
          <span style={{ width: `${(lent / total) * 100}%`, background: "var(--blue)" }} />
        </div>
      </div>

      {/* accounts */}
      <section className="section">
        <SectionHeader title="Accounts" subtitle="Every figure is since the account was opened." />
        {sorted.length === 0 ? (
          <div className="card">
            <EmptyState title="No company-money accounts" description="Add the VAT and non-VAT accounts to begin." icon="bank" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {sorted.map((item) => (
              <AccountPanel key={item.account.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {(tax.vatOwed > 0 || pendingBills > 0) && (
        <Callout
          className="mt-4"
          tone="amber"
          icon="receipt"
          title={<>VAT still to pay: NPR {formatNumber(tax.vatOwed)}{pendingBills > 0 ? ` · bills waiting to be reimbursed: NPR ${formatNumber(pendingBills)}` : ""}</>}
          action={<Link href="/vat" className="btn btn-sm">VAT & bills</Link>}
        >
          This VAT already sits inside the VAT account balance — keep it there until it is paid to IRD.
        </Callout>
      )}

      {/* activity */}
      <section className="section">
        <SectionHeader
          title="Activity"
          subtitle="Pick a month or any dates. Each line shows the balance after it, like a bank statement."
        />
        <StatementView events={events} accounts={accounts} today={today} scope="company" />
      </section>
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="text-[13px] muted flex items-center justify-end gap-1.5"><span className="dot" style={{ color: tone }} />{label}</div>
      <div className="text-[20px] font-semibold tnum mt-0.5">{formatNumber(value)}</div>
    </div>
  );
}

function AccountPanel({ item }: { item: MoneyAccountBalance }) {
  const { account } = item;
  const vat = account.kind === "company_bank";
  const tone = vat ? "var(--green)" : account.kind === "personal_custody" ? "var(--blue)" : "var(--accent-ink)";
  const moneyIn = [
    { label: "Client & other income", value: item.revenue - item.tdsWithheld },
    { label: "VAT collected", value: item.vatIn, hint: "for IRD" },
    { label: "Capital added", value: item.capitalIn, hint: "not revenue" },
    { label: "Moved in", value: item.transferredIn },
    { label: "Loans paid back", value: item.loanRepaidIn },
  ].filter((row) => row.value > 0.004);
  const moneyOut = [
    { label: "Spent", value: item.spent },
    { label: item.reimbursedOut > 0 ? "Moved out & reimbursed" : "Moved out", value: item.transferredOut },
    { label: "VAT paid to IRD", value: item.vatPaid },
    { label: "Lent out", value: item.lentOut },
  ].filter((row) => row.value > 0.004);
  const inTotal = moneyIn.reduce((sum, row) => sum + row.value, 0);
  const outTotal = moneyOut.reduce((sum, row) => sum + row.value, 0);
  const splitTotal = Math.max(item.free + item.vatReserved, 1);

  return (
    <div className="card overflow-hidden rise rise-1">
      <div className="p-5 border-b">
        <div className="flex items-center gap-3">
          <div className="row-icon" style={{ "--tone": tone, "--tone-soft": `color-mix(in srgb, ${tone} 14%, transparent)` } as React.CSSProperties}>
            <Icon name={vat ? "bank" : "wallet"} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">{accountLabel(account)}</div>
            <div className="text-[13px] muted truncate">{account.name}</div>
          </div>
          <span className="pill">{account.currency}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[13px] muted">Balance</div>
            <div className={`text-[30px] font-semibold tracking-tight leading-tight ${item.balance < 0 ? "text-red" : ""}`}>
              <Money value={item.balance} currency={account.currency} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] muted">Free to use</div>
            <div className="text-[20px] font-semibold tnum" style={{ color: tone }}>{formatNumber(item.free)}</div>
          </div>
        </div>
        {item.vatReserved > 0 && (
          <>
            <div className="stack-bar mt-3">
              <span style={{ width: `${(Math.max(item.free, 0) / splitTotal) * 100}%`, background: tone }} />
              <span style={{ width: `${(item.vatReserved / splitTotal) * 100}%`, background: "var(--amber)" }} />
            </div>
            <div className="mt-2 text-[13px] muted">
              <span className="text-amber font-medium">NPR {formatNumber(item.vatReserved)}</span> of this is VAT — don&apos;t spend it.
            </div>
          </>
        )}
      </div>
      <div className="grid sm:grid-cols-2">
        <FlowList title="Money in" icon="arrowDownLeft" tone="var(--green)" rows={moneyIn} total={inTotal} />
        <FlowList title="Money out" icon="arrowUpRight" tone="var(--red)" rows={moneyOut} total={outTotal} border />
      </div>
    </div>
  );
}

function FlowList({
  title,
  icon,
  tone,
  rows,
  total,
  border,
}: {
  title: string;
  icon: "arrowDownLeft" | "arrowUpRight";
  tone: string;
  rows: { label: string; value: number; hint?: string }[];
  total: number;
  border?: boolean;
}) {
  return (
    <div className={`p-5 ${border ? "sm:border-l border-t sm:border-t-0" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <Icon name={icon} size={15} className={tone === "var(--green)" ? "text-green" : "text-red"} />
          {title}
        </span>
        <span className="text-[15px] font-semibold tnum">{formatNumber(total)}</span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 && <div className="text-[13.5px] muted">Nothing yet</div>}
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="muted">
              {row.label}
              {row.hint && <span className="muted-2"> · {row.hint}</span>}
            </span>
            <span className="tnum">{formatNumber(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
