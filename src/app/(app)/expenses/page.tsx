import { query } from "@/lib/db";
import { requireExpenseAccess } from "@/lib/auth/server";
import { Avatar, EmptyState, FxBadge, Kpi, Money, PageHeader } from "@/components/ui";
import AddExpense from "@/components/AddExpense";
import ExpenseFilters from "@/components/ExpenseFilters";
import ExpenseRowActions from "@/components/ExpenseRowActions";
import { ExpenseFormDataProvider } from "@/components/ExpenseFormData";
import BulkSelect, { SelectBox, SelectGroup, SelectToggle } from "@/components/BulkSelect";
import { deleteExpenses } from "./actions";
import Icon from "@/components/Icons";
import { formatNumber, usd } from "@/lib/format";
import type { AppUser, Category, Expense, MoneyAccount, Vendor } from "@/lib/types";
import { ATTACHMENT_COLUMNS, attachmentUrl, type Attachment } from "@/lib/attachments";
import { assignedShareNpr, assignedShareOriginal, computeIndividualSpending } from "@/lib/individual";
import { canManageExpenses } from "@/lib/authz";
import { USER_COLUMNS, partnersOf, personTone } from "@/lib/people";
import { expenseWhere, scopeCondition, withFilters, type ExpenseScope, type ExpenseSearch } from "@/lib/expense-filters";
import { accountLabel } from "@/lib/statement";
import { dayLabel, monthLabel, nepalToday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<ExpenseSearch>;
}) {
  const sp = await searchParams;
  const session = await requireExpenseAccess();
  const canManage = canManageExpenses(session);
  const today = nepalToday();

  const [categories, vendors, users, moneyAccounts, agreementClients, vatAccounts] = await Promise.all([
    query<Category>(`select * from public.categories order by name`),
    query<Vendor>(`select * from public.vendors order by name`),
    query<AppUser>(`select ${USER_COLUMNS} from public.users order by name`),
    query<MoneyAccount>(`select * from public.money_accounts where is_active = true order by currency, name`),
    query<{ client_name: string }>(`select distinct client_name from public.income_agreements order by client_name`),
    query<{ id: string }>(`select id from public.money_accounts where kind = 'company_bank'`),
  ]);

  // Only the kinds of expenses this person may see (lib/access.ts).
  const allowed = session.access.expenses;
  const scope: ExpenseScope = { ledgers: allowed, vatAccountIds: vatAccounts.map((row) => row.id) };
  const vatIds = new Set(scope.vatAccountIds);
  const visibleAccounts = moneyAccounts.filter((account) => allowed.includes(vatIds.has(account.id) ? "vat" : "non_vat"));
  const { where, params, range } = expenseWhere(sp, moneyAccounts.map((account) => account.id), today, scope);
  const scoped = (extra: string, extraParams: unknown[] = []) => {
    const values = [...extraParams];
    const condition = scopeCondition(scope, (value) => `$${values.push(value)}`);
    return { sql: [extra, condition].filter(Boolean).join(" and "), values };
  };
  const monthsWhere = scoped("");
  const futureWhere = scoped("e.expense_date > $1", [today]);

  const [expenses, shareRows, billRows, monthRows, futureRow] = await Promise.all([
    query<Expense>(
      `select e.* from public.expenses e
         left join public.vendors v on v.id = e.vendor_id
         left join public.categories c on c.id = e.category_id
       ${where}
       order by e.expense_date desc, e.created_at desc
       limit 2000`,
      params
    ),
    query<{ expense_id: string }>(`select * from public.expense_shares`),
    query<Attachment>(
      `select ${ATTACHMENT_COLUMNS} from public.attachments
        where kind = 'expense_bill'
        order by created_at`
    ),
    query<{ month: string }>(
      `select distinct to_char(e.expense_date, 'YYYY-MM') as month from public.expenses e
        ${monthsWhere.sql ? `where ${monthsWhere.sql}` : ""}`,
      monthsWhere.values
    ),
    query<{ count: string }>(`select count(*) from public.expenses e where ${futureWhere.sql}`, futureWhere.values),
  ]);

  const partners = partnersOf(users);
  const clientNames = agreementClients.map((row) => row.client_name);
  const sourceRows = expenses.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter((share) => share.expense_id === expense.id),
    attachments: billRows.filter((bill) => bill.expense_id === expense.id),
  })) as Expense[];

  const selectedPersonId = sp.person ?? sp.payer ?? "";
  const basis = sp.basis === "paid" || (sp.payer && !sp.basis) ? "paid" : "share";
  const selectedPerson = users.find((member) => member.id === selectedPersonId) ?? null;
  const rows = !selectedPerson
    ? sourceRows
    : sourceRows.filter((expense) =>
        basis === "paid"
          ? expense.funding_source !== "company_funds" && expense.paid_by_user_id === selectedPerson.id
          : assignedShareNpr(expense, selectedPerson, users) > 0
      );

  const totals = computeIndividualSpending(users, sourceRows);
  const partnerTotals = partners.map((partner, index) => ({
    partner,
    index,
    ...(totals.find((row) => row.member.id === partner.id) ?? { assigned: 0, paid: 0 }),
  }));
  const partnerSum = partnerTotals.reduce((sum, row) => sum + row.assigned, 0);

  const amountOf = (expense: Expense) =>
    selectedPerson && basis === "share" ? assignedShareNpr(expense, selectedPerson, users) : Number(expense.amount_npr ?? 0);
  const total = rows.reduce((sum, expense) => sum + amountOf(expense), 0);
  const companyTotal = rows.filter((e) => e.funding_source === "company_funds").reduce((sum, e) => sum + amountOf(e), 0);
  const founderTotal = total - companyTotal;
  const pendingCount = rows.filter((e) => e.conversion_status === "pending").length;
  const usdTotal = rows.filter((e) => e.currency === "USD").reduce((sum, e) => sum + Number(e.amount), 0);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const accountById = new Map(moneyAccounts.map((account) => [account.id, account]));
  const shortName = (id: string | null) => userById.get(id ?? "")?.name.replace(/^Administrator$/, "Admin").split(" ")[0] ?? "—";

  // Group by month (bank-statement style), newest first.
  const months: { key: string; rows: Expense[]; total: number }[] = [];
  for (const expense of rows) {
    const key = expense.expense_date.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) {
      last.rows.push(expense);
      last.total += amountOf(expense);
    } else months.push({ key, rows: [expense], total: amountOf(expense) });
  }

  // The add / edit forms are for administrators; nobody else needs the lists.
  const formProps = canManage
    ? { categories, vendors, users, moneyAccounts, clients: clientNames }
    : { categories: [], vendors: [], users: [], moneyAccounts: [], clients: [] };

  return (
    <ExpenseFormDataProvider value={formProps}>
      <PageHeader
        title="Expenses"
        subtitle="Every cost Avernek has — company money and founder money — filtered instantly."
        action={canManage ? <AddExpense meId={session.sub} /> : undefined}
      />

      <ExpenseFilters
        sp={sp}
        periodLabel={range.label}
        monthKey={range.monthKey}
        today={today}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        vendors={vendors.map((v) => ({ value: v.id, label: v.name }))}
        clients={clientNames}
        people={allowed.includes("founder") ? partners.map((p) => ({ value: p.id, label: p.name })) : []}
        founder={allowed.includes("founder")}
        accounts={visibleAccounts.map((account) => ({ id: account.id, label: accountLabel(account) }))}
        monthsWithData={monthRows.map((row) => row.month)}
        futureCount={Number(futureRow[0]?.count ?? 0)}
      />

      <div className="kpi-grid mb-5">
        <Kpi
          label={selectedPerson ? `${selectedPerson.name}'s ${basis === "paid" ? "payments" : "share"}` : "Total"}
          icon="wallet"
          value={<Money value={total} />}
          foot={`${range.label}${usdTotal > 0 ? ` · incl. ${usd(usdTotal)}` : ""}`}
        />
        <Kpi label="Company money" icon="bank" tone="blue" value={<Money value={companyTotal} />} foot="VAT and non-VAT accounts" />
        <Kpi label="Founder money" icon="contribution" tone="pink" value={<Money value={founderTotal} />} foot="Paid from partners' own pockets" />
        <Kpi
          label="Transactions"
          icon="receipt"
          tone="muted"
          value={<span className="tnum">{rows.length}</span>}
          foot={rows.length ? `Average NPR ${formatNumber(Math.round(total / rows.length))}` : "Nothing in this view"}
        />
      </div>

      {allowed.includes("founder") && sp.ledger !== "company" && !sp.ledger?.startsWith("account:") && (
        <div className="grid sm:grid-cols-3 gap-3 mb-5">
          {partnerTotals.map(({ partner, index, assigned, paid }) => {
            const on = selectedPersonId === partner.id;
            return (
              <a
                key={partner.id}
                href={`/expenses${withFilters(sp, { person: on ? null : partner.id, payer: null, basis: on ? null : "share" })}`}
                className="card card-interactive p-4 flex items-center gap-3"
                style={on ? { borderColor: "var(--accent-line)", background: "var(--accent-soft)" } : undefined}
              >
                <Avatar name={partner.name} color={personTone(index)} size={40} round />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold truncate">{partner.name}</div>
                  <div className="text-[12.5px] muted">Paid personally {formatNumber(Math.round(paid))}</div>
                  <div className="bar-track !h-1.5 mt-2">
                    <div className="bar-fill" style={{ width: `${partnerSum ? (assigned / partnerSum) * 100 : 0}%`, "--bar": personTone(index) } as React.CSSProperties} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[17px] font-semibold tnum">{formatNumber(Math.round(assigned))}</div>
                  <div className="text-[12.5px] muted">invested</div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {pendingCount > 0 && (
        <div className="alert alert-warn mb-4">
          <Icon name="alert" size={16} /> {pendingCount} expense{pendingCount > 1 ? "s are" : " is"} missing an exchange rate — open the row menu and choose “Retry exchange rate”.
        </div>
      )}

      <BulkSelect
        ids={months.flatMap((month) => month.rows.map((e) => e.id))}
        noun={{ one: "expense", many: "expenses" }}
        onDelete={canManage ? deleteExpenses : undefined}
      >
        {rows.length > 1 && (
          <div className="flex justify-end mb-2">
            <SelectToggle />
          </div>
        )}
        <div className="card overflow-hidden">
          {rows.length === 0 && (
            <EmptyState title={`No expenses in ${range.label}`} description="Try another month, or clear the filters." icon="expense" />
          )}
          {months.map((month) => (
            <div key={month.key}>
              <div className="group-head">
                <span>
                  <SelectGroup ids={month.rows.map((e) => e.id)} label={monthLabel(month.key)} />
                  {monthLabel(month.key)} <span className="muted font-normal">· {month.rows.length} item{month.rows.length === 1 ? "" : "s"}</span>
                </span>
                <span className="tnum">NPR {formatNumber(month.total)}</span>
              </div>
              <div className="row-list">
                {month.rows.map((e) => {
                  const category = categoryById.get(e.category_id ?? "");
                  const vendor = vendorById.get(e.vendor_id ?? "");
                  const account = accountById.get(e.money_account_id ?? "");
                  const company = e.funding_source === "company_funds";
                  const title = e.note && vendor ? e.note : vendor?.name || e.note || category?.name || "Expense";
                  const shareNpr = selectedPerson && basis === "share" ? assignedShareNpr(e, selectedPerson, users) : null;
                  const shareOriginal = selectedPerson && basis === "share" ? assignedShareOriginal(e, selectedPerson, users) : null;
                  const future = e.expense_date > today;
                  return (
                    <div key={e.id} className="row-item !items-start">
                      <SelectBox id={e.id} label={title} />
                      <div className="row-icon mt-0.5" style={{ "--tone": category?.color && category.color !== "#1e3a5f" ? category.color : "var(--accent-ink)", "--tone-soft": "var(--surface-2)" } as React.CSSProperties}>
                        <Icon name={company ? "expense" : "user"} size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="row-title !whitespace-normal">{title}</span>
                          {company ? (
                            <span className="pill info">{account ? accountLabel(account).replace(" account", "") : "Company"}</span>
                          ) : (
                            <span className="pill" style={{ color: "var(--pink)" }}>Founder</span>
                          )}
                          {future && <span className="pill warn">Future date</span>}
                          {e.currency === "USD" && <FxBadge source={e.fx_source} status={e.conversion_status} />}
                          {e.is_reimbursed && <span className="pill ok">Reimbursed</span>}
                          {e.has_bill === false && <span className="pill">No bill</span>}
                          {e.attachments?.map((bill, index) => (
                            <a key={bill.id} href={attachmentUrl(bill.id)} target="_blank" rel="noopener" className="pill accent" title={bill.file_name}>
                              <Icon name="receipt" size={12} />
                              {e.attachments!.length > 1 ? `Bill ${index + 1}` : "Bill"}
                            </a>
                          ))}
                        </div>
                        <div className="row-meta !whitespace-normal">
                          {dayLabel(e.expense_date)} · {category?.name ?? "Uncategorised"}
                          {category?.counts_as_expense === false ? " (not a company expense)" : ""}
                          {vendor && e.note ? ` · ${vendor.name}` : ""}
                          {company ? "" : ` · paid by ${shortName(e.paid_by_user_id)}`}
                          {e.client ? ` · ${e.client}` : ""}
                          {e.billing_month && e.billing_month.slice(0, 7) !== e.expense_date.slice(0, 7) ? ` · for ${monthLabel(e.billing_month.slice(0, 7), "short")}` : ""}
                          {e.bill_number ? ` · Bill ${e.bill_number}` : ""}
                          {e.seller_pan ? ` · PAN ${e.seller_pan}` : ""}
                        </div>
                        {!!e.expense_shares?.length && !company && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {e.expense_shares.map((share) => (
                              <span key={share.user_id} className="pill !text-[12px]">
                                {shortName(share.user_id)} {e.currency === "USD" ? usd(Number(share.amount)) : formatNumber(Number(share.amount))}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="row-amount">{shareNpr != null ? formatNumber(shareNpr) : e.amount_npr != null ? formatNumber(Number(e.amount_npr)) : "—"}</div>
                        {shareNpr != null ? (
                          <div className="row-sub">
                            {e.currency === "USD" ? usd(shareOriginal ?? 0) : "share"} of {formatNumber(Number(e.amount_npr ?? 0))}
                          </div>
                        ) : e.currency === "USD" ? (
                          <div className="row-sub">{usd(Number(e.amount))}</div>
                        ) : null}
                      </div>
                      {canManage && (
                        <ExpenseRowActions expense={e} isReimbursed={e.is_reimbursed} pending={e.conversion_status === "pending"} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </BulkSelect>
    </ExpenseFormDataProvider>
  );
}
