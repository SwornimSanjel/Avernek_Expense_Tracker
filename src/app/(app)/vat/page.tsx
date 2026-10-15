import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, Money, PageHeader } from "@/components/ui";
import PanelTabs from "@/components/PanelTabs";
import {
  AddCompanyBill,
  ConfirmDelete,
  PayVat,
  ReimburseBill,
} from "@/components/VatBillsActions";
import { accountShortName } from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import { OTHER_INCOME_LABELS, formatServiceDate } from "@/lib/income";
import { deleteCompanyBill, deleteMoneyTransfer, deleteTaxPayment } from "../funds/actions";
import type { IncomeAgreement } from "@/lib/types";
import Icon from "@/components/Icons";
import { ATTACHMENT_COLUMNS, attachmentUrl, type Attachment } from "@/lib/attachments";
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

function FileLinks({ files, label }: { files: Attachment[]; label: string }) {
  if (!files.length) return null;
  return (
    <span className="flex flex-wrap gap-1 mt-1.5">
      {files.map((file, index) => (
        <a key={file.id} href={attachmentUrl(file.id)} target="_blank" rel="noopener" className="pill accent" title={file.file_name}>
          <Icon name="receipt" size={12} />
          {files.length > 1 ? `${label} ${index + 1}` : label}
        </a>
      ))}
    </span>
  );
}

/**
 * Everything VAT in one place: who paid us VAT and on how much, the bills in
 * Avernek's name that carry VAT we can claim, reimbursing those bills, and what
 * was deposited to IRD.
 */
export default async function VatPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const [ledger, agreements, files] = await Promise.all([
    loadLedger(),
    query<Pick<IncomeAgreement, "id" | "client_name">>(`select id, client_name from public.income_agreements`),
    query<Attachment>(
      `select ${ATTACHMENT_COLUMNS} from public.attachments
        where kind in ('vat_bill', 'company_bill')
        order by created_at`
    ),
  ]);
  const filesByOwner = new Map<string, Attachment[]>();
  for (const file of files) {
    const owner = file.payment_id ?? file.company_bill_id!;
    filesByOwner.set(owner, [...(filesByOwner.get(owner) ?? []), file]);
  }
  const { accounts, payments, otherIncome, taxPayments, balances, tax, billStatuses } = ledger;
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
  const pendingTotal = billStatuses.reduce((sum, item) => sum + item.pending, 0);
  const vatRoom = Math.max(0, balances.find((item) => item.account.kind === "company_bank")?.free ?? 0);

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
                  <td colSpan={2} className="font-semibold">{monthLabel(key)}</td>
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

  const billsPanel = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-[var(--surface-2)]">
        <p className="text-[13.5px] muted max-w-2xl">
          {pendingTotal > 0
            ? <>NPR {formatNumber(pendingTotal)} still to reimburse · NPR {formatNumber(vatRoom)} can be used from the VAT account right now.</>
            : "Lawyer, rent, printing… bills issued to Avernek and paid first from another account. Their VAT lowers what we owe IRD."}
        </p>
        {canManage && <AddCompanyBill compact />}
      </div>
      {billStatuses.length === 0 && (
        <EmptyState title="No bills yet" description="Press “Add VAT bill”, then “Reimburse” on it when the VAT account has room." icon="receipt" />
      )}
      <div className="row-list">
        {billStatuses.map((item) => (
          <div key={item.bill.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="row-icon" style={{ "--tone": "var(--amber)", "--tone-soft": "var(--amber-soft)" } as React.CSSProperties}>
                <Icon name="file" size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{item.bill.description}</div>
                <div className="text-[13px] muted mt-0.5">
                  {formatServiceDate(item.bill.bill_date)}
                  {item.bill.vendor_name ? ` · ${item.bill.vendor_name}` : ""}
                  {item.bill.bill_number ? ` · bill ${item.bill.bill_number}` : ""}
                  {item.bill.paid_by ? ` · paid by ${item.bill.paid_by}` : ""}
                </div>
                <FileLinks files={filesByOwner.get(item.bill.id) ?? []} label="Bill" />
              </div>
              <dl className="grid grid-cols-4 gap-5 text-right">
                <BillFigure label="Bill" value={formatNumber(Number(item.bill.total_amount))} />
                <BillFigure label="VAT in it" value={formatNumber(Number(item.bill.vat_amount))} tone="text-amber" />
                <BillFigure label="Paid back" value={formatNumber(item.reimbursed)} tone="text-green" />
                <BillFigure label="Pending" value={item.pending > 0 ? formatNumber(item.pending) : "Done"} tone={item.pending > 0 ? "text-amber" : "text-green"} />
              </dl>
              {canManage && (
                <div className="flex items-center gap-1.5">
                  {item.pending > 0 && <ReimburseBill bills={billStatuses} balances={balances} billId={item.bill.id} />}
                  <AddCompanyBill bill={item.bill} files={filesByOwner.get(item.bill.id) ?? []} />
                  {item.reimbursements.length === 0 && <ConfirmDelete id={item.bill.id} action={deleteCompanyBill} message="Delete this bill?" />}
                </div>
              )}
            </div>
            {item.reimbursements.length > 0 && (
              <div className="mt-3 ml-[52px] space-y-1.5">
                {item.reimbursements.map((transfer) => (
                  <div key={transfer.id} className="flex items-center gap-3 text-[13px] card-soft px-3 py-2">
                    <Icon name="swap" size={14} className="text-blue" />
                    <span className="flex-1 min-w-0 truncate muted">
                      Reimbursed {formatServiceDate(transfer.transfer_date)} · {accountShortName(accountById.get(transfer.from_account_id))} → {accountShortName(accountById.get(transfer.to_account_id))}
                    </span>
                    <strong className="tnum">{formatNumber(Number(transfer.from_amount))}</strong>
                    {canManage && <ConfirmDelete id={transfer.id} action={deleteMoneyTransfer} message="Delete this reimbursement? The money goes back to the VAT account." />}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );

  const paidPanel = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-[var(--surface-2)]">
        <p className="text-[13.5px] muted">Each deposit lowers both the VAT account and the VAT still to pay.</p>
        {canManage && <PayVat balances={balances} vatOwed={tax.vatOwed} />}
      </div>
      {taxPayments.length === 0 && <EmptyState title="No VAT payment recorded yet" description="Record each deposit to IRD here." icon="bank" />}
      <div className="row-list">
        {taxPayments.map((row) => (
          <div key={row.id} className="row-item">
            <div className="row-icon" style={{ "--tone": "var(--accent-ink)", "--tone-soft": "var(--accent-soft)" } as React.CSSProperties}><Icon name="bank" size={17} /></div>
            <div className="min-w-0 flex-1">
              <div className="row-title">VAT paid{row.period_label ? ` · ${row.period_label}` : ""}</div>
              <div className="row-meta">{formatServiceDate(row.paid_on)}{row.reference ? ` · ${row.reference}` : ""} · {accountShortName(accountById.get(row.money_account_id))}</div>
            </div>
            <div className="row-amount">{formatNumber(Number(row.amount))}</div>
            {canManage && <ConfirmDelete id={row.id} action={deleteTaxPayment} message="Delete this VAT payment record?" />}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title="VAT & bills"
        subtitle="What Avernek owes IRD, how it is worked out, and company bills that need reimbursing."
        action={
          canManage ? (
            <>
              <AddCompanyBill />
              <ReimburseBill bills={billStatuses} balances={balances} />
              <PayVat balances={balances} vatOwed={tax.vatOwed} />
            </>
          ) : undefined
        }
      />

      {/* the VAT sum, as an equation anyone can follow */}
      <div className="card p-6 dot-pattern rise">
        <div className="text-[14px] font-semibold">VAT position</div>
        <p className="text-[13.5px] muted mt-0.5">An estimate from what is recorded here — not the official return.</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-5 mt-5">
          <Term label="VAT we collected" sub="13% on top of our charges" value={tax.outputVat} />
          <Op>−</Op>
          <Term label="VAT on our bills" sub="We can claim this back" value={tax.inputVat} />
          <Op>−</Op>
          <Term label="Already paid to IRD" sub={`${taxPayments.length} deposit${taxPayments.length === 1 ? "" : "s"}`} value={tax.vatDeposited} />
          <Op>=</Op>
          <div className="rounded-2xl px-5 py-4 border" style={{ borderColor: "rgb(251 191 36 / 0.3)", background: "var(--amber-soft)" }}>
            <div className="text-[13px] text-amber font-semibold">Still to pay</div>
            <div className="text-[30px] font-semibold tracking-tight leading-tight mt-1"><Money value={tax.vatOwed} /></div>
            <div className="text-[12.5px] muted mt-1">
              {tax.vatCarryForward > 0 ? `NPR ${formatNumber(tax.vatCarryForward)} extra to carry forward` : "Keep it in the VAT account"}
            </div>
          </div>
        </div>
        {tax.tdsCredit > 0 && (
          <div className="mt-5 pt-4 border-t text-[13.5px]">
            <span className="text-green font-semibold">TDS credit NPR {formatNumber(tax.tdsCredit)}</span>
            <span className="muted"> — withheld by clients; claim it in the income tax return.</span>
          </div>
        )}
      </div>

      <div className="section">
        <PanelTabs
          initial={pendingTotal > 0 ? "bills" : "collected"}
          tabs={[
            { key: "collected", label: "VAT we collected", count: collected.length, content: collectedPanel },
            { key: "bills", label: "Bills in Avernek's name", count: billStatuses.length, content: billsPanel },
            { key: "paid", label: "Paid to IRD", count: taxPayments.length, content: paidPanel },
          ]}
        />
      </div>
    </>
  );
}

function Term({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <div className="min-w-[150px]">
      <div className="text-[13px] muted">{label}</div>
      <div className="text-[24px] font-semibold tracking-tight tnum mt-1">{formatNumber(value)}</div>
      <div className="text-[12.5px] muted-2 mt-0.5">{sub}</div>
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return <div className="text-[26px] font-light muted-2 px-1">{children}</div>;
}

function BillFigure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[12.5px] muted">{label}</dt>
      <dd className={`mt-0.5 text-[15px] font-semibold tnum ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
