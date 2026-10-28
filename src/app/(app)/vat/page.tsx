import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader } from "@/components/ui";
import PanelTabs from "@/components/PanelTabs";
import { ConfirmDelete, PayTax, type TaxPeriodOption } from "@/components/VatBillsActions";
import FileLinks from "@/components/FileLinks";
import Link from "@/components/AppLink";
import TaxOverview from "@/components/TaxOverview";
import { daysUntil, firstTaxMonth, tdsPeriods, upcomingDeadlines, vatPeriods, type PeriodStatus } from "@/lib/tax-calendar";
import { bsMonthLabel, fiscalYearOf, formatBs } from "@/lib/nepali-date";
import { accountShortName, claimedVat } from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import { OTHER_INCOME_LABELS, formatServiceDate, todayIso } from "@/lib/income";
import { deleteTaxPayment, deleteTaxPayments } from "../funds/actions";
import BulkSelect, { SelectBox, SelectToggle } from "@/components/BulkSelect";
import type { Category, IncomeAgreement } from "@/lib/types";
import Icon from "@/components/Icons";
import { ATTACHMENT_COLUMNS, type Attachment } from "@/lib/attachments";
import { formatNumber } from "@/lib/format";
import { monthLabel } from "@/lib/dates";

export const dynamic = "force-dynamic";

type VatRow = {
  key: string;
  date: string;
  from: string;
  forWhat: string;
  charge: number;
  vat: number;
  tds: number;
  bank: number;
  account: string;
  /** VAT bills uploaded for this receipt, if one was cut. */
  bills: Attachment[];
};

/**
 * VAT and TDS in one place: what was collected and claimed, what is owed and
 * when, month by Nepali month, TDS, and what was paid to IRD. The bills behind
 * the claimed VAT live on the Bills page.
 */
export default async function VatPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const [ledger, agreements, files, categories] = await Promise.all([
    loadLedger(),
    query<Pick<IncomeAgreement, "id" | "client_name">>(`select id, client_name from public.income_agreements`),
    query<Attachment>(
      `select ${ATTACHMENT_COLUMNS} from public.attachments
        where kind in ('vat_bill', 'company_bill')
        order by created_at`
    ),
    query<Pick<Category, "id" | "name">>(`select id, name from public.categories`),
  ]);
  const filesByOwner = new Map<string, Attachment[]>();
  for (const file of files) {
    const owner = file.payment_id ?? file.company_bill_id!;
    filesByOwner.set(owner, [...(filesByOwner.get(owner) ?? []), file]);
  }
  const { accounts, payments, otherIncome, taxPayments, balances, tax } = ledger;
  const clientById = new Map(agreements.map((agreement) => [agreement.id, agreement.client_name]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const collected: VatRow[] = [
    ...payments
      .filter((payment) => Number(payment.vat_amount) > 0)
      .map((payment) => ({
        key: `p-${payment.id}`,
        date: payment.paid_on,
        from: clientById.get(payment.agreement_id) ?? "Client",
        forWhat:
          payment.payment_for === "setup"
            ? "Setup fee"
            : payment.payment_for === "website"
              ? "Website"
              : payment.billing_period_start
                ? `Monthly fee · from ${formatServiceDate(payment.billing_period_start)}`
                : "Monthly fee",
        charge: Number(payment.amount),
        vat: Number(payment.vat_amount),
        tds: Number(payment.tds_amount),
        bank: bankAmount(payment),
        account: accountShortName(accountById.get(payment.money_account_id ?? "")),
        bills: filesByOwner.get(payment.id) ?? [],
      })),
    ...otherIncome
      .filter((row) => Number(row.vat_amount) > 0)
      .map((row) => ({
        key: `o-${row.id}`,
        date: row.received_on,
        from: row.source_name || "No client",
        forWhat: `${OTHER_INCOME_LABELS[row.category]} · ${row.description}`,
        charge: Number(row.amount),
        vat: Number(row.vat_amount),
        tds: Number(row.tds_amount),
        bank: bankAmount(row),
        account: accountShortName(accountById.get(row.money_account_id)),
        bills: [],
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const months = [...new Set(collected.map((row) => row.date.slice(0, 7)))];

  // Month by Nepali month: what each VAT and TDS return asks, and when it is due.
  const today = todayIso();
  const { bills, expenses } = ledger;
  const startKey = firstTaxMonth({ payments, otherIncome, bills, taxPayments, today });
  const vatByMonth = vatPeriods({ payments, otherIncome, bills, taxPayments, startKey, today });
  const salaryCategories = new Set(categories.filter((category) => /salar/i.test(category.name)).map((category) => category.id));
  const salaries = expenses
    .filter((expense) => salaryCategories.has(expense.category_id ?? ""))
    .map((expense) => ({ date: expense.expense_date, amount: Number(expense.amount_npr ?? expense.amount) }));
  const tdsByMonth = tdsPeriods({ payments, otherIncome, salaries, taxPayments, startKey, today });
  const deadlines = upcomingDeadlines({ vat: vatByMonth, tds: tdsByMonth, startKey, today });
  const shortDate = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  // Returns are recorded for months that have ended; the running month only when none has.
  const optionsFrom = (periods: { key: string; label: string; status: string; filed: boolean; payable?: number }[]): TaxPeriodOption[] => {
    const closed = periods.filter((period) => period.status !== "open");
    return (closed.length ? closed : periods).map((period) => ({ key: period.key, label: period.label, payable: period.payable ?? 0, filed: period.filed }));
  };
  const vatOptions = optionsFrom(vatByMonth);
  const tdsOptions = optionsFrom(tdsByMonth);
  const vatBills = [...bills]
    .filter((bill) => Number(bill.vat_amount) > 0)
    .sort((a, b) => b.bill_date.localeCompare(a.bill_date));
  const fiscalYear = fiscalYearOf(today);
  const salariesThisYear = salaries.filter((row) => fiscalYearOf(row.date).start === fiscalYear.start).reduce((sum, row) => sum + row.amount, 0);
  const tdsDeposited = taxPayments.filter((row) => row.tax_type === "tds").reduce((sum, row) => sum + Number(row.amount), 0);

  const collectedPanel =
    collected.length === 0 ? (
      <EmptyState title="No VAT collected yet" description="Payments recorded with “VAT bill · 13% on top” show up here." icon="receipt" />
    ) : (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th className="num">Our charge</th>
              <th className="num">VAT 13%</th>
              <th className="num">TDS kept</th>
              <th className="num">Reached bank</th>
            </tr>
          </thead>
          <tbody>
            {months.map((key) => {
              const rows = collected.filter((row) => row.date.startsWith(key));
              const sum = (pick: (row: VatRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
              return [
                <tr key={`h-${key}`} className="!bg-[var(--surface-2)]">
                  {/* The month's total, not another receipt: say so, as the bills tab does. */}
                  <td colSpan={2}>
                    <span className="font-semibold">{monthLabel(key)}</span>
                    <span className="muted"> · {rows.length} {rows.length === 1 ? "receipt" : "receipts"} · month total</span>
                  </td>
                  <td className="num font-semibold">{formatNumber(sum((row) => row.charge))}</td>
                  <td className="num font-semibold text-amber">{formatNumber(sum((row) => row.vat))}</td>
                  <td className="num font-semibold">{formatNumber(sum((row) => row.tds))}</td>
                  <td className="num font-semibold">{formatNumber(sum((row) => row.bank))}</td>
                </tr>,
                ...rows.map((row) => (
                  <tr key={row.key}>
                    <td className="whitespace-nowrap">{formatServiceDate(row.date)}</td>
                    <td>
                      <div className="font-medium">{row.from}</div>
                      <div className="text-[12.5px] muted">{row.forWhat} · {row.account}</div>
                      <FileLinks files={row.bills} label="VAT bill" />
                    </td>
                    <td className="num">{formatNumber(row.charge)}</td>
                    <td className="num text-amber font-medium">{formatNumber(row.vat)}</td>
                    <td className="num">{row.tds > 0 ? formatNumber(row.tds) : "—"}</td>
                    <td className="num font-medium">{formatNumber(row.bank)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    );

  const taxName = (row: (typeof taxPayments)[number]) =>
    row.tax_type === "tds" ? "TDS deposited" : row.tax_type === "income_tax" ? "Income tax paid" : Number(row.amount) === 0 ? "VAT nil return filed" : "VAT paid";
  const paidPanel = (
    <BulkSelect
      ids={taxPayments.map((row) => row.id)}
      noun={{ one: "tax record", many: "tax records" }}
      onDelete={canManage ? deleteTaxPayments : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-[var(--surface-2)]">
        <p className="text-[13.5px] muted">VAT returns (nil ones too), TDS deposits and income tax paid to IRD.</p>
        <div className="flex flex-wrap items-center gap-2">
          {taxPayments.length > 1 && <SelectToggle />}
          {canManage && <PayTax kind="vat" balances={balances} periods={vatOptions} />}
          {canManage && <PayTax kind="tds" balances={balances} periods={tdsOptions} />}
        </div>
      </div>
      {taxPayments.length === 0 && <EmptyState title="Nothing recorded yet" description="Record each VAT return (nil ones too) and TDS deposit here after filing." icon="bank" />}
      <div className="row-list">
        {taxPayments.map((row) => (
          <div key={row.id} className="row-item">
            <SelectBox id={row.id} label={taxName(row)} />
            <div className="row-icon" style={{ "--tone": row.tax_type === "tds" ? "var(--blue)" : "var(--accent-ink)", "--tone-soft": row.tax_type === "tds" ? "var(--blue-soft)" : "var(--accent-soft)" } as React.CSSProperties}><Icon name="bank" size={17} /></div>
            <div className="min-w-0 flex-1">
              <div className="row-title">{taxName(row)}{row.period_label ? ` · ${row.period_label}` : ""}</div>
              <div className="row-meta">{formatServiceDate(row.paid_on)}{row.reference ? ` · ${row.reference}` : ""}{Number(row.amount) > 0 ? ` · ${accountShortName(accountById.get(row.money_account_id))}` : ""}</div>
            </div>
            <div className="row-amount">{formatNumber(Number(row.amount))}</div>
            {canManage && <ConfirmDelete id={row.id} action={deleteTaxPayment} message="Delete this tax record?" />}
          </div>
        ))}
      </div>
    </BulkSelect>
  );

  const tdsPanel = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-[var(--surface-2)]">
        <p className="text-[13.5px] muted max-w-2xl">Tax held back when paying salaries, rent or some services, deposited to IRD by the 25th of the next Nepali month.</p>
        {canManage && <PayTax kind="tds" balances={balances} periods={tdsOptions} />}
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3 border-b">
        <MiniFigure label="TDS clients held back from us" value={tax.tdsCredit} sub="A credit: claim it in the yearly income tax return" tone="text-green" />
        <MiniFigure label={`Salaries paid · FY ${fiscalYear.label}`} value={salariesThisYear} sub="TDS usually applies to salaries" />
        <MiniFigure label="TDS deposited" value={tdsDeposited} sub="Recorded here after depositing" />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Salaries paid</th>
              <th className="num">TDS deposited</th>
              <th>Due by</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...tdsByMonth].reverse().map((period) => (
              <tr key={period.key}>
                <td>
                  <div className="font-medium">{period.label}</div>
                  <div className="text-[12px] muted">{shortDate(period.from)} – {shortDate(period.to)}</div>
                </td>
                <td className="num tnum">{period.salaries ? formatNumber(period.salaries) : "—"}</td>
                <td className="num tnum">{period.filed ? formatNumber(period.deposited) : "—"}</td>
                <td>
                  <div>{formatBs(period.due)}</div>
                  <div className="text-[12px] muted">{formatServiceDate(period.due)}</div>
                </td>
                <td><StatusPill status={period.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-4 border-t">
        <div className="text-[14px] font-semibold">When Avernek must hold back TDS</div>
        <ul className="mt-2 space-y-1.5 text-[13.5px] muted list-disc pl-5">
          <li><strong className="text-[var(--ink)]">Salary:</strong> income tax by each person’s slab, held back every month. The first slab is a 1% social security tax (not for staff in the Social Security Fund).</li>
          <li><strong className="text-[var(--ink)]">Rent:</strong> 10% of the rent.</li>
          <li><strong className="text-[var(--ink)]">Services or contracts from a business:</strong> usually 1.5% when the business is VAT-registered; other cases differ.</li>
          <li>Deposit it and file e-TDS with each payee’s PAN by the 25th of the next Nepali month, then record it here.</li>
        </ul>
        <p className="mt-2 text-[12.5px] muted-2">Rates change with each budget: check ird.gov.np before depositing. Months with no salary show “Nothing to deposit”.</p>
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title="VAT & TDS"
        subtitle="What Avernek owes IRD, when it is due, and how it is worked out."
        action={
          <>
            <Link href="/bills" className="btn !h-9 text-sm">
              <Icon name="file" size={15} /> Bills
            </Link>
            {canManage && <PayTax kind="vat" balances={balances} periods={vatOptions} />}
          </>
        }
      />

      {/* VAT at a glance: four boxes that open their details, then the deadlines */}
      <TaxOverview
        collected={tax.outputVat}
        paidOnBills={vatBills.reduce((sum, bill) => sum + Number(bill.vat_amount), 0)}
        deductible={tax.inputVat}
        deposited={tax.vatDeposited}
        owed={tax.vatOwed}
        carryForward={tax.vatCarryForward}
        receipts={collected.map((row) => ({ id: row.key, date: formatServiceDate(row.date), who: row.from, what: row.forWhat, vat: row.vat }))}
        vatBills={vatBills.map((bill) => ({
          id: bill.id,
          date: formatServiceDate(bill.bill_date),
          shop: bill.vendor_name || bill.description,
          vat: Number(bill.vat_amount),
          claimed: claimedVat(bill) > 0,
        }))}
        periods={vatByMonth.map((period) => ({
          key: period.key,
          label: period.label,
          range: `${shortDate(period.from)} – ${shortDate(period.to)}`,
          collected: period.collected,
          deductible: period.deductible,
          carriedIn: period.carriedIn,
          payable: period.payable,
          paid: period.paid,
          dueBs: formatBs(period.due),
          dueAd: formatServiceDate(period.due),
          status: period.status,
        }))}
        deadlines={deadlines.map((deadline) => ({
          key: deadline.key,
          kind: deadline.kind,
          title: deadline.title,
          detail: deadline.detail,
          dueBs: deadline.dueBs,
          dueAd: formatServiceDate(deadline.due),
          daysLeft: daysUntil(deadline.due, today),
          late: deadline.late,
          amount: deadline.amount,
        }))}
        firstMonth={bsMonthLabel(startKey)}
      />

      <div className="section">
        <PanelTabs
          initial="collected"
          tabs={[
            { key: "collected", label: "VAT we collected", count: collected.length, content: collectedPanel },
            { key: "tds", label: "TDS", content: tdsPanel },
            { key: "paid", label: "Paid to IRD", count: taxPayments.length, content: paidPanel },
          ]}
        />
      </div>
    </>
  );
}

function MiniFigure({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: string }) {
  return (
    <div>
      <div className="text-[13px] muted">{label}</div>
      <div className={`text-[22px] font-semibold tracking-tight tnum mt-0.5 ${tone ?? ""}`}>{formatNumber(value)}</div>
      <div className="text-[12.5px] muted-2 mt-0.5">{sub}</div>
    </div>
  );
}

function StatusPill({ status }: { status: PeriodStatus | "none" }) {
  if (status === "none") return <span className="pill">Nothing to deposit</span>;
  if (status === "filed") return <span className="pill ok">Deposited</span>;
  if (status === "open") return <span className="pill">This month</span>;
  if (status === "late") return <span className="pill danger">Late</span>;
  return <span className="pill warn">Due</span>;
}
