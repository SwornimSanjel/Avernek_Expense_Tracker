import Link from "next/link";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { EmptyState, PageHeader } from "@/components/ui";
import { AddCompanyBill, ConfirmDelete, ReimburseBill } from "@/components/VatBillsActions";
import BillsByMonth, { type BillItem } from "@/components/BillsByMonth";
import FileLinks from "@/components/FileLinks";
import ReceiptIntake from "@/components/ReceiptIntake";
import { MergeReceiptButton, ReceiptCopyFixer, SettleOldBillsButton, type MergeOption } from "@/components/OldBillTools";
import { findReceiptCopies } from "@/lib/bill-duplicates";
import { BillExpenseStatus, BillTypePicker, type ExpenseMatch } from "@/components/BillRowControls";
import Icon from "@/components/Icons";
import { accountShortName, claimedVat } from "@/lib/funds";
import { loadLedger } from "@/lib/ledger";
import { formatServiceDate, todayIso } from "@/lib/income";
import { formatNumber } from "@/lib/format";
import { ATTACHMENT_COLUMNS, type Attachment } from "@/lib/attachments";
import { billTypeLabel, sortBillCategories, type BillCategory } from "@/lib/bill-types";
import { USER_COLUMNS, partnersOf } from "@/lib/people";
import { isAiEnabled } from "@/lib/ai/config";
import { deleteCompanyBill, deleteCompanyBills, deleteMoneyTransfer } from "../funds/actions";

export const dynamic = "force-dynamic";

type ExpenseReceipt = {
  id: string;
  expense_date: string;
  amount: string;
  currency: string;
  amount_npr: string | null;
  note: string | null;
  category_id: string | null;
  vendor: string | null;
  funding_source: string;
  money_account_id: string | null;
  payer: string | null;
  /** Created by a receipt upload (not typed by hand): may repeat a typed expense. */
  from_upload: boolean;
};

type Row = {
  id: string;
  date: string;
  categoryId: string | null;
  vendor: string;
  /** Not counted as an expense yet, and should be. */
  todo: boolean;
  item: BillItem;
};

/**
 * Every bill and receipt, sorted into types (Food, Stationery, AI
 * subscriptions…): Nepali bills with their VAT, and receipts attached to
 * expenses (Claude, ChatGPT and any other expense with a bill photo). Each
 * Nepali bill shows whether it is counted in Expenses, so nothing is counted
 * twice and nothing is missed.
 */
export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; vendor?: string }>;
}) {
  const session = await requireSession();
  const canManage = isAppOwner(session);
  const filters = await searchParams;
  const [ledger, files, categories, people, receipts, linked, matchRows, copies, mergeRows] = await Promise.all([
    loadLedger(),
    query<Attachment>(`select ${ATTACHMENT_COLUMNS} from public.attachments where kind in ('company_bill','expense_bill') order by created_at`),
    query<BillCategory>(`select id, name, color, coalesce(counts_as_expense, true) as counts_as_expense from public.categories`),
    query<{ id: string; name: string; is_partner: boolean }>(`select ${USER_COLUMNS} from public.users order by name`),
    query<ExpenseReceipt>(
      `select e.id, e.expense_date, e.amount, e.currency, e.amount_npr, e.note, e.category_id, v.name as vendor,
              e.funding_source, e.money_account_id, u.name as payer,
              (coalesce(e.note, '') like '% · receipt %'
               and exists (select 1 from public.attachments a
                            where a.expense_id = e.id
                              and abs(extract(epoch from e.created_at - a.created_at)) < 3600)) as from_upload
         from public.expenses e
         left join public.vendors v on v.id = e.vendor_id
         left join public.users u on u.id = e.paid_by_user_id
        where exists (select 1 from public.attachments a where a.expense_id = e.id)
          and not exists (select 1 from public.company_bills b where b.expense_id = e.id)
        order by e.expense_date desc`
    ),
    query<{ bill_id: string; expense_date: string; funding_source: string; money_account_id: string | null; payer: string | null }>(
      `select b.id as bill_id, e.expense_date, e.funding_source, e.money_account_id, u.name as payer
         from public.company_bills b
         join public.expenses e on e.id = b.expense_id
         left join public.users u on u.id = e.paid_by_user_id`
    ),
    // Expenses that look like an uncounted bill: same amount, within a week.
    query<{ bill_id: string; id: string; expense_date: string; amount: string; label: string }>(
      `select b.id as bill_id, e.id, e.expense_date, coalesce(e.amount_npr, e.amount) as amount,
              coalesce(nullif(e.note, ''), v.name, 'Expense') as label
         from public.company_bills b
         join public.expenses e
           on e.currency = 'NPR'
          and abs(coalesce(e.amount_npr, e.amount) - b.total_amount) <= greatest(2, b.total_amount * 0.01)
          and abs(e.expense_date - b.bill_date) <= 10
         left join public.vendors v on v.id = e.vendor_id
        where b.expense_id is null
          and not exists (select 1 from public.company_bills other where other.expense_id = e.id)
        order by abs(e.expense_date - b.bill_date)`
    ),
    findReceiptCopies(),
    // For each expense made by a receipt upload: the hand-typed expenses near
    // it that it might repeat, so the receipt can be merged into the right one.
    query<{ copy_id: string; id: string; expense_date: string; label: string; currency: string; amount: string; amount_npr: string | null; funding_source: string; money_account_id: string | null; payer: string | null }>(
      `select copy.id as copy_id, e.id, e.expense_date,
              coalesce(nullif(e.note, ''), v.name, c.name, 'Expense') as label,
              e.currency, e.amount, e.amount_npr, e.funding_source, e.money_account_id, u.name as payer
         from public.expenses copy
         join public.expenses e
           on e.id <> copy.id
          and abs(e.expense_date - copy.expense_date) <= 20
          and (e.category_id is not distinct from copy.category_id
               or e.vendor_id = copy.vendor_id
               or abs(coalesce(e.amount_npr, e.amount) - coalesce(copy.amount_npr, copy.amount))
                  <= greatest(5, coalesce(copy.amount_npr, copy.amount) * 0.05))
          and not exists (select 1 from public.company_bills b where b.expense_id = e.id)
         left join public.vendors v on v.id = e.vendor_id
         left join public.categories c on c.id = e.category_id
         left join public.users u on u.id = e.paid_by_user_id
        where coalesce(copy.note, '') like '% · receipt %'
          and exists (select 1 from public.attachments a where a.expense_id = copy.id
                       and abs(extract(epoch from copy.created_at - a.created_at)) < 3600)
          and not exists (select 1 from public.attachments a where a.expense_id = e.id
                           and abs(extract(epoch from e.created_at - a.created_at)) < 3600
                           and coalesce(e.note, '') like '% · receipt %')
        order by copy.id,
                 abs(coalesce(e.amount_npr, e.amount) - coalesce(copy.amount_npr, copy.amount)),
                 abs(e.expense_date - copy.expense_date)`
    ),
  ]);

  const { accounts, balances, billStatuses } = ledger;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const partners = partnersOf(people).map((person) => ({ id: person.id, name: person.name }));
  const filesByBill = new Map<string, Attachment[]>();
  const filesByExpense = new Map<string, Attachment[]>();
  for (const file of files) {
    if (file.company_bill_id) filesByBill.set(file.company_bill_id, [...(filesByBill.get(file.company_bill_id) ?? []), file]);
    if (file.expense_id) filesByExpense.set(file.expense_id, [...(filesByExpense.get(file.expense_id) ?? []), file]);
  }
  const linkedByBill = new Map(linked.map((row) => [row.bill_id, row]));
  const mergeOptions = new Map<string, MergeOption[]>();
  for (const row of mergeRows) {
    const list = mergeOptions.get(row.copy_id) ?? [];
    if (list.length >= 8) continue;
    list.push({
      id: row.id,
      date: row.expense_date,
      label: row.label,
      amountText:
        row.currency === "NPR"
          ? `NPR ${formatNumber(Number(row.amount))}`
          : `${row.currency} ${formatNumber(Number(row.amount))}${row.amount_npr ? ` · NPR ${formatNumber(Number(row.amount_npr))}` : ""}`,
      paidFrom:
        row.funding_source === "company_funds"
          ? accountShortName(accountById.get(row.money_account_id ?? ""))
          : `${row.payer ?? "A partner"}'s own money`,
    });
    mergeOptions.set(row.copy_id, list);
  }
  const matchesByBill = new Map<string, ExpenseMatch[]>();
  for (const row of matchRows) {
    const list = matchesByBill.get(row.bill_id) ?? [];
    if (list.length < 4) list.push({ id: row.id, date: row.expense_date, amount: Number(row.amount), label: row.label });
    matchesByBill.set(row.bill_id, list);
  }
  const pendingTotal = billStatuses.reduce((sum, item) => sum + item.pending, 0);
  const vatRoom = Math.max(0, balances.find((item) => item.account.kind === "company_bank")?.free ?? 0);
  const paidFrom = (source: string, accountId: string | null, payer: string | null) =>
    source === "company_funds" ? accountShortName(accountById.get(accountId ?? "")) : `${payer ?? "A partner"}'s own money`;
  const accountOptions = accounts.map((account) => ({ id: account.id, name: account.name, kind: account.kind, currency: account.currency }));

  // ---- one row per bill or receipt ----------------------------------------------
  const billRows: Row[] = billStatuses.map((status) => {
    const bill = status.bill;
    const category = categoryById.get(bill.category_id ?? "");
    const counts = category ? category.counts_as_expense : true;
    const link = linkedByBill.get(bill.id);
    return {
      id: bill.id,
      date: bill.bill_date,
      categoryId: bill.category_id,
      vendor: bill.vendor_name || bill.description,
      todo: !bill.expense_id && !bill.counted_elsewhere && counts,
      item: {
        id: bill.id,
        date: bill.bill_date,
        total: Number(bill.total_amount),
        vat: Number(bill.vat_amount),
        claimed: claimedVat(bill),
        pending: status.pending,
        content: (
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="row-icon" style={{ "--tone": category?.color ?? "var(--amber)", "--tone-soft": "var(--surface-3)" } as React.CSSProperties}>
                <Icon name="file" size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{bill.vendor_name || bill.description}</div>
                <div className="text-[13px] muted mt-0.5">
                  {formatServiceDate(bill.bill_date)}
                  {bill.vendor_name ? ` · ${bill.description}` : ""}
                  {bill.bill_number ? ` · bill ${bill.bill_number}` : ""}
                  {bill.paid_by ? ` · paid by ${bill.paid_by}` : ""}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <BillTypePicker billId={bill.id} categoryId={bill.category_id} categories={categories} canManage={canManage} />
                  <BillExpenseStatus
                    billId={bill.id}
                    linked={link ? `Counted as an expense on ${formatServiceDate(link.expense_date)}, paid from ${paidFrom(link.funding_source, link.money_account_id, link.payer)}` : null}
                    elsewhere={Boolean(bill.counted_elsewhere)}
                    counts={counts}
                    total={Number(bill.total_amount)}
                    matches={matchesByBill.get(bill.id) ?? []}
                    accounts={accountOptions}
                    people={partners}
                    canManage={canManage}
                  />
                </div>
                <FileLinks files={filesByBill.get(bill.id) ?? []} label="Bill" />
              </div>
              <dl className={`grid ${status.paysBack ? "grid-cols-5" : "grid-cols-3"} gap-5 text-right`}>
                <BillFigure label="Bill" value={formatNumber(Number(bill.total_amount))} />
                <BillFigure label="VAT in it" value={formatNumber(Number(bill.vat_amount))} tone="text-amber" />
                <BillFigure label="VAT claimed" value={formatNumber(claimedVat(bill))} tone={claimedVat(bill) > 0 ? "text-green" : "muted"} />
                {status.paysBack && (
                  <>
                    <BillFigure label="Paid back" value={formatNumber(status.reimbursed)} tone="text-green" />
                    <BillFigure label="Pending" value={status.pending > 0 ? formatNumber(status.pending) : "Done"} tone={status.pending > 0 ? "text-amber" : "text-green"} />
                  </>
                )}
              </dl>
              {canManage && (
                <div className="flex items-center gap-1.5">
                  {status.pending > 0 && <ReimburseBill bills={billStatuses} balances={balances} billId={bill.id} />}
                  <AddCompanyBill bill={bill} files={filesByBill.get(bill.id) ?? []} categories={categories} />
                  <ConfirmDelete
                    id={bill.id}
                    action={deleteCompanyBill}
                    message={
                      bill.expense_id
                        ? "Delete this bill? Its expense stays in Expenses — delete that there if it should go too."
                        : status.reimbursements.length
                          ? `Delete this bill? The NPR ${formatNumber(status.reimbursed)} already paid back stays in the accounts as a money movement, so no balance changes.`
                          : "Delete this bill?"
                    }
                  />
                </div>
              )}
            </div>
            {status.reimbursements.length > 0 && (
              <div className="mt-3 ml-[52px] space-y-1.5">
                {status.reimbursements.map((transfer) => (
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
      },
    };
  });

  const receiptRows: Row[] = receipts.map((receipt) => {
    const category = categoryById.get(receipt.category_id ?? "");
    const foreign = receipt.currency !== "NPR";
    const npr = receipt.amount_npr != null ? Number(receipt.amount_npr) : foreign ? 0 : Number(receipt.amount);
    return {
      id: receipt.id,
      date: receipt.expense_date,
      categoryId: receipt.category_id,
      vendor: receipt.vendor || receipt.note || "Expense",
      todo: false,
      item: {
        id: receipt.id,
        date: receipt.expense_date,
        total: npr,
        vat: 0,
        claimed: 0,
        pending: 0,
        content: (
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="row-icon" style={{ "--tone": category?.color ?? "var(--blue)", "--tone-soft": "var(--surface-3)" } as React.CSSProperties}>
                <Icon name="receipt" size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{receipt.vendor || receipt.note || "Expense"}</div>
                <div className="text-[13px] muted mt-0.5">
                  {formatServiceDate(receipt.expense_date)}
                  {receipt.vendor && receipt.note ? ` · ${receipt.note}` : ""}
                  {` · paid with ${paidFrom(receipt.funding_source, receipt.money_account_id, receipt.payer)}`}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="bill-type">
                    <span className="bill-type-dot" style={{ background: category?.color ?? "var(--muted-2)" }} />
                    {billTypeLabel(category?.name)}
                  </span>
                  <Link href="/expenses" className="bill-status bill-status-ok" title="This receipt belongs to an expense">
                    <Icon name="check" size={13} /> In expenses
                  </Link>
                  {foreign && <span className="bill-status">Foreign receipt · no Nepali VAT</span>}
                  {canManage && receipt.from_upload && (
                    <MergeReceiptButton
                      copyId={receipt.id}
                      copyText={`${foreign ? `${receipt.currency} ${formatNumber(Number(receipt.amount))} · ` : ""}NPR ${formatNumber(npr)}`}
                      paidFrom={paidFrom(receipt.funding_source, receipt.money_account_id, receipt.payer)}
                      options={mergeOptions.get(receipt.id) ?? []}
                    />
                  )}
                </div>
                <FileLinks files={filesByExpense.get(receipt.id) ?? []} label="Receipt" />
              </div>
              <dl className="grid grid-cols-2 gap-5 text-right">
                <BillFigure label="Paid" value={foreign ? `${receipt.currency} ${formatNumber(Number(receipt.amount))}` : formatNumber(Number(receipt.amount))} />
                <BillFigure label="In NPR" value={receipt.amount_npr != null ? formatNumber(Number(receipt.amount_npr)) : "—"} />
              </dl>
            </div>
          </div>
        ),
      },
    };
  });

  const allRows = [...billRows, ...receiptRows].sort((a, b) => b.date.localeCompare(a.date));

  // ---- type tabs ------------------------------------------------------------------
  const usedTypes = sortBillCategories(
    categories.filter((category) => allRows.some((row) => row.categoryId === category.id))
  );
  const untyped = allRows.filter((row) => !row.categoryId || !categoryById.has(row.categoryId)).length;
  const todo = allRows.filter((row) => row.todo).length;
  const type = filters.type ?? "";
  const inType = allRows.filter((row) =>
    type === "todo"
      ? row.todo
      : type === "none"
        ? !row.categoryId || !categoryById.has(row.categoryId)
        : type
          ? row.categoryId === type
          : true
  );
  const vendors = [...new Set(inType.map((row) => row.vendor))];
  const showVendors = Boolean(type && type !== "todo" && type !== "none" && vendors.length > 1 && vendors.length <= 8);
  const rows = showVendors && filters.vendor ? inType.filter((row) => row.vendor === filters.vendor) : inType;
  const sumOf = (list: Row[]) => list.reduce((total, row) => total + row.item.total, 0);
  const href = (next: { type?: string; vendor?: string }) => {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.vendor) params.set("vendor", next.vendor);
    const text = params.toString();
    return text ? `/bills?${text}` : "/bills";
  };
  const selected = categoryById.get(type);

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle="Every bill and receipt by type — with its VAT, and counted in expenses once."
        action={
          canManage ? (
            <>
              <ReceiptIntake categories={categories} accounts={accountOptions} people={partners} aiEnabled={isAiEnabled()} />
              <AddCompanyBill categories={categories} label="Type a bill" />
              <ReimburseBill bills={billStatuses} balances={balances} />
            </>
          ) : undefined
        }
      />

      <nav className="bill-tabs rise" aria-label="Bill types">
        <Link href={href({})} className={`chip ${!type ? "chip-on" : ""}`}>
          All <span className="chip-count">{allRows.length}</span>
        </Link>
        {usedTypes.map((category) => {
          const list = allRows.filter((row) => row.categoryId === category.id);
          return (
            <Link key={category.id} href={href({ type: category.id })} className={`chip ${type === category.id ? "chip-on" : ""}`} title={`NPR ${formatNumber(sumOf(list))}`}>
              <span className="bill-type-dot" style={{ background: category.color }} />
              {billTypeLabel(category.name)} <span className="chip-count">{list.length}</span>
            </Link>
          );
        })}
        {untyped > 0 && (
          <Link href={href({ type: "none" })} className={`chip ${type === "none" ? "chip-on" : ""}`}>
            No type yet <span className="chip-count">{untyped}</span>
          </Link>
        )}
        {todo > 0 && (
          <Link href={href({ type: "todo" })} className={`chip chip-warn ${type === "todo" ? "chip-on" : ""}`}>
            <Icon name="alert" size={13} /> Not linked <span className="chip-count">{todo}</span>
          </Link>
        )}
      </nav>

      {showVendors && (
        <nav className="bill-tabs bill-tabs-sub" aria-label="Vendors">
          <Link href={href({ type })} className={`chip ${!filters.vendor ? "chip-on" : ""}`}>
            All {billTypeLabel(selected?.name)}
          </Link>
          {vendors.map((vendor) => {
            const list = inType.filter((row) => row.vendor === vendor);
            return (
              <Link key={vendor} href={href({ type, vendor })} className={`chip ${filters.vendor === vendor ? "chip-on" : ""}`}>
                {vendor} <span className="chip-count">{list.length}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {selected && !selected.counts_as_expense && (
        <p className="receipt-note mb-3">
          <Icon name="info" size={14} /> {billTypeLabel(selected.name)} is not a company expense: these bills are kept for the record only and are not counted in expenses.
        </p>
      )}
      {canManage && <ReceiptCopyFixer copies={copies} />}
      {todo > 0 && (
        <div className="receipt-note mb-3 flex-wrap">
          <Icon name="alert" size={14} />
          <span className="flex-1 min-w-[220px]">
            {todo} {todo === 1 ? "bill is" : "bills are"} not linked to an expense yet. Already typed into Expenses? Link them all at once — no money changes. A bill never typed in: press “Link to its expense” on it and choose “add it now”.
          </span>
          {canManage && <SettleOldBillsButton count={todo} />}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b bg-[var(--surface-2)]">
          <p className="text-[13.5px] muted max-w-2xl">
            {pendingTotal > 0
              ? <>NPR {formatNumber(pendingTotal)} still to reimburse · NPR {formatNumber(vatRoom)} can be used from the VAT account right now.</>
              : <>Showing {rows.length} {rows.length === 1 ? "bill" : "bills"} · NPR {formatNumber(sumOf(rows))} in total.</>}
          </p>
        </div>
        {allRows.length === 0 && (
          <EmptyState
            title="No bills yet"
            description="Press “Add bills & receipts” and drop your PDFs and photos — they are sorted by type and counted in expenses."
            icon="receipt"
          />
        )}
        {allRows.length > 0 && rows.length === 0 && (
          <EmptyState title="Nothing in this type" description="Pick another type, or All." icon="filter" />
        )}
        {rows.length > 0 && (
          <BillsByMonth
            today={todayIso()}
            onDelete={canManage ? deleteCompanyBills : undefined}
            locked={Object.fromEntries(receiptRows.map((row) => [row.id, "This receipt belongs to an expense — delete it on the Expenses page."]))}
            items={rows.map((row) => row.item)}
          />
        )}
      </div>
      <p className="text-[13px] muted mt-3">
        VAT from these bills shows on <Link href="/vat" className="link-more inline-flex">VAT &amp; TDS <Icon name="arrow" size={13} /></Link>. Foreign receipts (Claude, ChatGPT) have no Nepali VAT: their full amount is the expense.
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
