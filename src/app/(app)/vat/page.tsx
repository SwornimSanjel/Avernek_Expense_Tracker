import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader, SectionHeader, StatTile } from "@/components/ui";
import {
  AddCompanyBill,
  ConfirmDelete,
  PayVat,
  ReimburseBill,
} from "@/components/VatBillsActions";
import { accountShortName } from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { bankAmount } from "@/lib/tax";
import { OTHER_INCOME_LABELS, formatIncomeMoney, formatServiceDate } from "@/lib/income";
import { deleteCompanyBill, deleteMoneyTransfer, deleteTaxPayment } from "../funds/actions";
import type { IncomeAgreement } from "@/lib/types";
import Icon from "@/components/Icons";
import { ATTACHMENT_COLUMNS, attachmentUrl, type Attachment } from "@/lib/attachments";

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
    <span className="flex flex-wrap gap-1 mt-1">
      {files.map((file, index) => (
        <a
          key={file.id}
          href={attachmentUrl(file.id)}
          target="_blank"
          rel="noopener"
          className="pill bill-pill"
          title={file.file_name}
        >
          <Icon name="receipt" size={11} />
          {files.length > 1 ? `${label} ${index + 1}` : label}
        </a>
      ))}
    </span>
  );
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${key}-01T00:00:00Z`)
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

  // ---- VAT we collected: one row per receipt that carried VAT ---------------
  const collected: VatRow[] = [
    ...payments
      .filter((payment) => Number(payment.vat_amount) > 0)
      .map((payment) => ({
        key: `p-${payment.id}`,
        date: payment.paid_on,
        from: clientById.get(payment.agreement_id) ?? "Client",
        forWhat:
          payment.payment_for === "setup"
            ? "Setup · month 1"
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

  const months = [...new Set(collected.map((row) => monthKey(row.date)))];
  const pendingTotal = billStatuses.reduce((sum, item) => sum + item.pending, 0);
  const vatRoom = Math.max(0, balances.find((item) => item.account.kind === "company_bank")?.free ?? 0);
  const money = (value: number) => formatIncomeMoney(value, "NPR");

  return (
    <>
      <PageHeader
        eyebrow="Tax"
        title="VAT & bills"
        subtitle="Who paid us VAT and on how much, bills in Avernek's name that need reimbursing, and VAT paid to IRD."
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <AddCompanyBill />
              <ReimburseBill bills={billStatuses} balances={balances} />
              <PayVat balances={balances} vatOwed={tax.vatOwed} />
            </div>
          ) : undefined
        }
      />

      {/* ------------------------------------------------------------ totals */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
        <StatTile label="VAT we collected" value={money(tax.outputVat)} hint="13% on top of our service charges" icon="receipt" tone="blue" />
        <StatTile label="VAT on our bills" value={`−${money(tax.inputVat)}`} hint="Inside bills in Avernek's name · we claim it" icon="receipt" tone="green" />
        <StatTile label="VAT paid to IRD" value={`−${money(tax.vatDeposited)}`} hint="Deposits recorded so far" icon="bank" tone="accent" />
        <StatTile
          label="VAT still to pay"
          value={money(tax.vatOwed)}
          hint={tax.vatCarryForward > 0 ? `${money(tax.vatCarryForward)} extra input VAT to carry forward` : "Keep this in the VAT account · estimate"}
          emphasis
          icon="clock"
          tone="amber"
        />
        <StatTile label="TDS credit" value={money(tax.tdsCredit)} hint="Withheld by clients · claim in income tax" icon="contribution" tone="green" />
      </div>

      {/* ------------------------------------------------- VAT we collected */}
      <div className="mb-6">
        <SectionHeader
          title="VAT we collected"
          subtitle="Every payment that came with VAT: who paid, our service charge, the VAT on top and any TDS they kept."
        />
        <div className="card mt-3 overflow-hidden">
          {collected.length === 0 ? (
            <EmptyState
              title="No VAT collected yet"
              description="Payments recorded with “VAT bill · 13% on top” show up here."
              icon="receipt"
            />
          ) : (
            <div className="price-table-wrap !border-0 !rounded-none">
              <table className="price-table register-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From whom</th>
                    <th>Service charge</th>
                    <th>VAT 13%</th>
                    <th>TDS kept</th>
                    <th>Reached bank</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((key) => {
                    const rows = collected.filter((row) => monthKey(row.date) === key);
                    const sum = (pick: (row: VatRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
                    return [
                      <tr key={`h-${key}`} className="register-month">
                        <td colSpan={2}>{monthLabel(key)} · total</td>
                        <td>{money(sum((row) => row.charge))}</td>
                        <td>{money(sum((row) => row.vat))}</td>
                        <td>{money(sum((row) => row.tds))}</td>
                        <td>{money(sum((row) => row.bank))}</td>
                      </tr>,
                      ...rows.map((row) => (
                        <tr key={row.key}>
                          <td>{formatServiceDate(row.date)}</td>
                          <td className="register-who">
                            <strong>{row.from}</strong>
                            <small>{row.forWhat} · {row.account}</small>
                            <FileLinks files={row.bills} label="VAT bill" />
                          </td>
                          <td>{money(row.charge)}</td>
                          <td className="register-vat">{money(row.vat)}</td>
                          <td>{row.tds > 0 ? money(row.tds) : "—"}</td>
                          <td>{money(row.bank)}</td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- bills */}
      <div className="mb-6">
        <SectionHeader
          title="Bills in Avernek's name"
          subtitle={
            pendingTotal > 0
              ? `${money(pendingTotal)} still to reimburse · ${money(vatRoom)} can be used from the VAT account right now (VAT is kept aside)`
              : "Lawyer, rent, printing… bills issued to the company and paid first from another account. Their VAT lowers what we owe IRD."
          }
          action={canManage ? <AddCompanyBill compact /> : undefined}
        />
        <div className="card mt-3 overflow-hidden">
          {billStatuses.length === 0 && (
            <EmptyState
              title="No bills yet"
              description="Press “Add VAT bill”, then “Reimburse” on it when the VAT account has room."
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
                  <FileLinks files={filesByOwner.get(item.bill.id) ?? []} label="Bill" />
                </div>
                <dl className="bill-row-figures">
                  <div><dt>Bill</dt><dd>{money(Number(item.bill.total_amount))}</dd></div>
                  <div><dt>VAT in it</dt><dd>{money(Number(item.bill.vat_amount))}</dd></div>
                  <div><dt>Paid back</dt><dd style={{ color: "var(--green)" }}>{money(item.reimbursed)}</dd></div>
                  <div><dt>Pending</dt><dd style={{ color: item.pending > 0 ? "var(--amber)" : "var(--green)" }}>{item.pending > 0 ? money(item.pending) : "Done"}</dd></div>
                </dl>
                {canManage && (
                  <div className="flex items-center gap-1 justify-end">
                    {item.pending > 0 && <ReimburseBill bills={billStatuses} balances={balances} billId={item.bill.id} />}
                    <AddCompanyBill bill={item.bill} files={filesByOwner.get(item.bill.id) ?? []} />
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
                        Reimbursed {formatServiceDate(transfer.transfer_date)} ·{" "}
                        {accountShortName(accountById.get(transfer.from_account_id))} →{" "}
                        {accountShortName(accountById.get(transfer.to_account_id))}
                      </span>
                      <strong className="tnum">{money(Number(transfer.from_amount))}</strong>
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

      {/* ------------------------------------------------- VAT paid to IRD */}
      <div>
        <SectionHeader
          title="VAT paid to IRD"
          subtitle="Each VAT deposit lowers both the VAT account and the VAT still to pay."
          action={canManage ? <PayVat balances={balances} vatOwed={tax.vatOwed} /> : undefined}
        />
        <div className="card mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {taxPayments.length === 0 && <p className="px-5 py-5 text-sm muted">No VAT payment recorded yet.</p>}
          {taxPayments.map((row) => (
            <div key={row.id} className="px-4 py-3 flex items-center gap-3 text-sm" style={{ borderColor: "var(--line)" }}>
              <span className="flex-1 min-w-0 truncate">
                VAT paid{row.period_label ? ` · ${row.period_label}` : ""}
                <span className="muted text-xs"> · {formatServiceDate(row.paid_on)}{row.reference ? ` · ${row.reference}` : ""}</span>
              </span>
              <strong className="tnum">{money(Number(row.amount))}</strong>
              {canManage && <ConfirmDelete id={row.id} action={deleteTaxPayment} message="Delete this VAT payment record?" />}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
