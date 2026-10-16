import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, Kpi, Money, PageHeader } from "@/components/ui";
import AddOtherIncome from "@/components/AddOtherIncome";
import BulkSelect, { SelectBox, SelectToggle } from "@/components/BulkSelect";
import { deleteOtherIncomes } from "../income/actions";
import { OTHER_INCOME_LABELS, formatServiceDate, todayIso } from "@/lib/income";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import { formatNumber } from "@/lib/format";
import { accountLabel } from "@/lib/statement";
import { monthName } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Income with no client agreement: a quick website for someone who never
 * signed, extra work, consulting. It is revenue (unlike capital or loans), so
 * it counts in Income totals — it just has no billing schedule.
 */
export default async function OtherIncomePage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const { accounts: moneyAccounts, otherIncome } = await loadLedger();
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));
  const thisMonth = todayIso().slice(0, 7);
  const sum = (rows: typeof otherIncome, pick: (row: (typeof otherIncome)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const monthRows = otherIncome.filter((row) => row.received_on.startsWith(thisMonth));

  return (
    <>
      <PageHeader
        title="Other income"
        subtitle="Money earned without a client agreement — one-off jobs and extra work."
        action={canManage ? <AddOtherIncome accounts={moneyAccounts} /> : undefined}
      />

      <div className="kpi-grid">
        <Kpi
          label={`Earned · ${monthName(thisMonth, "long")}`}
          icon="income"
          tone="green"
          value={<Money value={sum(monthRows, (row) => Number(row.amount))} />}
          foot={`${monthRows.length} job${monthRows.length === 1 ? "" : "s"} this month`}
        />
        <Kpi
          label="Earned all time"
          icon="trendUp"
          tone="accent"
          value={<Money value={sum(otherIncome, (row) => Number(row.amount))} />}
          foot="Excluding VAT"
        />
        <Kpi
          label="VAT on it"
          icon="receipt"
          tone="amber"
          value={<Money value={sum(otherIncome, (row) => Number(row.vat_amount))} />}
          foot="Kept aside for IRD"
        />
        <Kpi
          label="Reached the bank"
          icon="bank"
          tone="blue"
          value={<Money value={sum(otherIncome, bankAmount)} />}
          foot={`${otherIncome.length} record${otherIncome.length === 1 ? "" : "s"}`}
        />
      </div>

      <section className="section">
        <BulkSelect
          ids={otherIncome.map((row) => row.id)}
          noun={{ one: "income record", many: "income records" }}
          onDelete={canManage ? deleteOtherIncomes : undefined}
        >
          {otherIncome.length > 1 && (
            <div className="flex justify-end mb-2">
              <SelectToggle />
            </div>
          )}
          <div className="card overflow-hidden">
            {otherIncome.length === 0 ? (
              <EmptyState title="Nothing yet" description="Use “Income without client” for extra work or a website done without an agreement." icon="sparkles" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>What</th>
                      <th>Account</th>
                      <th className="num">Amount</th>
                      <th className="num">Reached bank</th>
                      {canManage && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {otherIncome.map((row) => {
                      const account = accountById.get(row.money_account_id);
                      return (
                        <tr key={row.id}>
                          <td className="whitespace-nowrap">
                            <span className="inline-flex items-center">
                              <SelectBox id={row.id} label={row.description} />
                              {formatServiceDate(row.received_on)}
                            </span>
                          </td>
                          <td>
                            <div className="font-medium">{row.description}</div>
                            <div className="text-[12.5px] muted">
                              {OTHER_INCOME_LABELS[row.category]}
                              {row.source_name ? ` · from ${row.source_name}` : ""}
                              {Number(row.vat_amount) > 0 ? ` · VAT ${formatNumber(Number(row.vat_amount))}` : ""}
                              {Number(row.tds_amount) > 0 ? ` · TDS ${formatNumber(Number(row.tds_amount))}` : ""}
                            </div>
                          </td>
                          <td>{account ? accountLabel(account) : "—"}</td>
                          <td className="num font-semibold text-green">{formatNumber(Number(row.amount))}</td>
                          <td className="num">{formatNumber(bankAmount(row))}</td>
                          {canManage && <td className="w-12"><AddOtherIncome accounts={moneyAccounts} record={row} /></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </BulkSelect>
      </section>
    </>
  );
}
