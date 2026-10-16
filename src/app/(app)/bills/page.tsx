import Link from "next/link";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader } from "@/components/ui";
import { AddCompanyBill, ConfirmDelete, ReimburseBill } from "@/components/VatBillsActions";
import BillsByMonth from "@/components/BillsByMonth";
import FileLinks from "@/components/FileLinks";
import Icon from "@/components/Icons";
import { accountShortName, claimedVat } from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { formatServiceDate, todayIso } from "@/lib/income";
import { formatNumber } from "@/lib/format";
import { ATTACHMENT_COLUMNS, type Attachment } from "@/lib/attachments";
import { deleteCompanyBill, deleteCompanyBills, deleteMoneyTransfer } from "../funds/actions";

export const dynamic = "force-dynamic";

/**
 * Bills issued in Avernek's name (cafes, shops, lawyers…), month by month:
 * what was paid, the VAT printed on each and whether that VAT is claimed, and
 * paying a bill back from the VAT account when someone paid it first. The VAT
 * they carry feeds VAT & TDS.
 */
export default async function BillsPage() {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const [ledger, files] = await Promise.all([
    loadLedger(),
    query<Attachment>(
      `select ${ATTACHMENT_COLUMNS} from public.attachments
        where kind = 'company_bill'
        order by created_at`
    ),
  ]);
  const filesByOwner = new Map<string, Attachment[]>();
  for (const file of files) {
    const owner = file.company_bill_id!;
    filesByOwner.set(owner, [...(filesByOwner.get(owner) ?? []), file]);
  }
  const { accounts, balances, billStatuses } = ledger;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const pendingTotal = billStatuses.reduce((sum, item) => sum + item.pending, 0);
  const vatRoom = Math.max(0, balances.find((item) => item.account.kind === "company_bank")?.free ?? 0);

  const billsPanel = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-[var(--surface-2)]">
        <p className="text-[13.5px] muted max-w-2xl">
          {pendingTotal > 0
            ? <>NPR {formatNumber(pendingTotal)} still to reimburse · NPR {formatNumber(vatRoom)} can be used from the VAT account right now.</>
            : "Bills issued to Avernek: cafes, shops, lawyers… Their VAT lowers what we owe IRD."}
        </p>
        {canManage && <AddCompanyBill compact />}
      </div>
      {billStatuses.length === 0 && (
        <EmptyState title="No bills yet" description="Press “Add VAT bill”, then “Reimburse” on it when the VAT account has room." icon="receipt" />
      )}
      {billStatuses.length > 0 && (
        <BillsByMonth
          today={todayIso()}
          onDelete={canManage ? deleteCompanyBills : undefined}
          items={billStatuses.map((item) => ({
            id: item.bill.id,
            date: item.bill.bill_date,
            total: Number(item.bill.total_amount),
            vat: Number(item.bill.vat_amount),
            claimed: claimedVat(item.bill),
            pending: item.pending,
            content: (
              <div className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="row-icon" style={{ "--tone": "var(--amber)", "--tone-soft": "var(--amber-soft)" } as React.CSSProperties}>
                    <Icon name="file" size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* The shop is the title; what it was for sits underneath. */}
                    <div className="text-[15px] font-semibold">{item.bill.vendor_name || item.bill.description}</div>
                    <div className="text-[13px] muted mt-0.5">
                      {formatServiceDate(item.bill.bill_date)}
                      {item.bill.vendor_name ? ` · ${item.bill.description}` : ""}
                      {item.bill.bill_number ? ` · bill ${item.bill.bill_number}` : ""}
                      {item.bill.paid_by ? ` · paid by ${item.bill.paid_by}` : ""}
                    </div>
                    <FileLinks files={filesByOwner.get(item.bill.id) ?? []} label="Bill" />
                  </div>
                  <dl className={`grid ${item.paysBack ? "grid-cols-5" : "grid-cols-3"} gap-5 text-right`}>
                    <BillFigure label="Bill" value={formatNumber(Number(item.bill.total_amount))} />
                    <BillFigure label="VAT in it" value={formatNumber(Number(item.bill.vat_amount))} tone="text-amber" />
                    {/* What comes off the VAT owed to IRD: 0 when the VAT cannot be claimed. */}
                    <BillFigure label="VAT claimed" value={formatNumber(claimedVat(item.bill))} tone={claimedVat(item.bill) > 0 ? "text-green" : "muted"} />
                    {/* Only a bill being paid back from the VAT account has these. */}
                    {item.paysBack && (
                      <>
                        <BillFigure label="Paid back" value={formatNumber(item.reimbursed)} tone="text-green" />
                        <BillFigure label="Pending" value={item.pending > 0 ? formatNumber(item.pending) : "Done"} tone={item.pending > 0 ? "text-amber" : "text-green"} />
                      </>
                    )}
                  </dl>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      {item.pending > 0 && <ReimburseBill bills={billStatuses} balances={balances} billId={item.bill.id} />}
                      <AddCompanyBill bill={item.bill} files={filesByOwner.get(item.bill.id) ?? []} />
                      <ConfirmDelete
                        id={item.bill.id}
                        action={deleteCompanyBill}
                        message={
                          item.reimbursements.length
                            ? `Delete this bill? The NPR ${formatNumber(item.reimbursed)} already paid back stays in the accounts as a money movement, so no balance changes.`
                            : "Delete this bill?"
                        }
                      />
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
                        {canManage && (
                          <ConfirmDelete
                            id={transfer.id}
                            action={deleteMoneyTransfer}
                            message={`Delete this payment back? This CHANGES BALANCES: NPR ${formatNumber(Number(transfer.from_amount))} goes back into ${accountShortName(accountById.get(transfer.from_account_id))} and out of ${accountShortName(accountById.get(transfer.to_account_id))}. Only do this if the money never actually moved.`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle="Bills issued to Avernek, month by month: what was paid and the VAT on each."
        action={
          canManage ? (
            <>
              <AddCompanyBill />
              <ReimburseBill bills={billStatuses} balances={balances} />
            </>
          ) : undefined
        }
      />
      <div className="card overflow-hidden rise">{billsPanel}</div>
      <p className="text-[13px] muted mt-3">
        The VAT on these bills shows on <Link href="/vat" className="link-more inline-flex">VAT &amp; TDS <Icon name="arrow" size={13} /></Link>, where you see what to pay IRD and when.
      </p>
    </>
  );
}

function BillFigure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[12.5px] muted">{label}</dt>
      <dd className={`mt-0.5 text-[15px] font-semibold tnum ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
