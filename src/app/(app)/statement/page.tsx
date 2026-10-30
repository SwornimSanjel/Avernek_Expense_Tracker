import { requireSection } from "@/lib/auth/server";
import { Kpi, Money, PageHeader } from "@/components/ui";
import StatementView from "@/components/StatementView";
import { loadStatement } from "@/lib/statement-data";
import { nepalToday } from "@/lib/dates";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StatementPage() {
  await requireSection("statement");
  const today = nepalToday();
  const { events, accounts, ledger } = await loadStatement();
  const held = ledger.balances.reduce((total, item) => total + item.balance, 0);
  const free = ledger.balances.reduce((total, item) => total + item.free, 0);
  const vatReserved = ledger.balances.reduce((total, item) => total + item.vatReserved, 0);
  const openLoans = ledger.loans.filter((loan) => !loan.repaid_on).reduce((total, loan) => total + Number(loan.amount), 0);

  return (
    <>
      <PageHeader
        title="Statement"
        subtitle="Like a bank statement for the whole company: pick a month or any dates, then every rupee in and out with running balances."
      />

      <div className="kpi-grid mb-6">
        <Kpi label="In the accounts" icon="bank" tone="accent" value={<Money value={held} />} foot="VAT and non-VAT together" />
        <Kpi label="Free to use" icon="wallet" tone="green" value={<Money value={free} />} foot="After keeping VAT aside" />
        <Kpi label="VAT kept aside" icon="receipt" tone="amber" value={<Money value={vatReserved} />} foot="Belongs to IRD" />
        <Kpi label="Lent out" icon="arrowUpRight" tone="blue" value={<Money value={openLoans} />} foot={openLoans > 0 ? `Not paid back yet` : "No open loans"} />
      </div>

      <StatementView events={events} accounts={accounts} today={today} />
      <p className="mt-3 text-[13px] muted">
        Founder-paid expenses show on the statement but never change an account balance. Moving money between the VAT and
        non-VAT accounts is shown on both sides and nets to zero on “All”. Totals use NPR {formatNumber(1)} = NPR 1; USD bills
        use the NPR amount frozen on their date.
      </p>
    </>
  );
}
