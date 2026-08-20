import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { EmptyState, PageHeader, FxBadge, SectionHeader } from "@/components/ui";
import AddExpense from "@/components/AddExpense";
import { npr, usd } from "@/lib/format";
import type { AppUser, Category, Expense, MoneyAccount, Vendor } from "@/lib/types";
import ExpenseRowActions from "@/components/ExpenseRowActions";
import {
  assignedShareNpr,
  assignedShareOriginal,
  computeIndividualSpending,
} from "@/lib/individual";
import { canManageExpenses } from "@/lib/authz";
import Icon from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    ledger?: string;
    payer?: string;
    person?: string;
    basis?: "share" | "paid";
    month?: string;
    vendor?: string;
    client?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const canManage = canManageExpenses(session);

  const [cats, vends, team, accounts, agreementClients] = await Promise.all([
    query<Category>(`select * from public.categories order by name`),
    query<Vendor>(`select * from public.vendors order by name`),
    query<AppUser>(`select id, name, email, is_core_member, is_admin from public.users order by name`),
    query<MoneyAccount>(`select * from public.money_accounts where is_active = true order by currency, name`),
    query<{ client_name: string }>(
      `select distinct client_name from public.income_agreements order by client_name`
    ),
  ]);

  // Filters are optional, so the WHERE clause is assembled from whichever
  // search params are present. Values always go through $n placeholders —
  // never interpolated — because they come straight from the query string.
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (sp.cat) {
    params.push(sp.cat);
    conditions.push(`category_id = $${params.length}`);
  }
  if (sp.vendor) {
    params.push(sp.vendor);
    conditions.push(`vendor_id = $${params.length}`);
  }
  if (sp.client) {
    params.push(sp.client);
    conditions.push(`lower(btrim(client)) = lower(btrim($${params.length}))`);
  }
  if (sp.ledger === "founder") {
    conditions.push(`funding_source <> 'company_funds'`);
  } else if (sp.ledger === "company") {
    conditions.push(`funding_source = 'company_funds'`);
  } else if (sp.ledger?.startsWith("account:")) {
    const accountId = sp.ledger.slice("account:".length);
    const selectedAccount = accounts.find((account) => account.id === accountId);
    if (selectedAccount) {
      params.push(selectedAccount.id);
      conditions.push(`funding_source = 'company_funds'`);
      conditions.push(`money_account_id = $${params.length}`);
    }
  }
  if (/^\d{4}-\d{2}$/.test(sp.month ?? "")) {
    params.push(`${sp.month}-01`);
    conditions.push(`billing_month = $${params.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  // A query failure now throws to the error boundary rather than rendering
  // expenses with silently missing splits.
  const shareError = null;

  const [expenses, shareRows] = await Promise.all([
    query<Expense>(
      `select * from public.expenses
       ${where}
       order by expense_date desc
       limit 1000`,
      params
    ),
    query<{ expense_id: string }>(`select * from public.expense_shares`),
  ]);

  const categories = cats as Category[];
  const vendors = vends as Vendor[];
  const users = team as AppUser[];
  const moneyAccounts = accounts as MoneyAccount[];
  const clientNames = agreementClients.map((row) => row.client_name);
  const sourceRows = expenses.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];
  const selectedPersonId = sp.person ?? sp.payer ?? "";
  const basis = sp.basis ?? (sp.payer ? "paid" : "share");
  const selectedPerson = users.find((member) => member.id === selectedPersonId) ?? null;
  const selectedLedgerAccount = sp.ledger?.startsWith("account:")
    ? moneyAccounts.find((account) => account.id === sp.ledger?.slice("account:".length)) ?? null
    : null;
  const ledgerLabel = sp.ledger === "founder"
    ? "Founder/team investment"
    : sp.ledger === "company"
      ? "All company operating money"
      : selectedLedgerAccount?.name ?? "All expense ledgers";
  const showFounderTotals = sp.ledger !== "company" && !selectedLedgerAccount;

  const totals = computeIndividualSpending(users, sourceRows);
  const rows = !selectedPerson
    ? sourceRows
    : sourceRows.filter((expense) =>
        basis === "paid"
          ? expense.funding_source !== "company_funds" && expense.paid_by_user_id === selectedPerson.id
          : assignedShareNpr(expense, selectedPerson, users) > 0
      );

  const catName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "—";
  const vendorName = (id: string | null) =>
    vendors.find((v) => v.id === id)?.name ?? "";
  const payerName = (id: string | null) =>
    users.find((u) => u.id === id)?.name.split(" ")[0] ?? "—";
  const accountName = (id: string | null) =>
    moneyAccounts.find((account) => account.id === id)?.name ?? "Company account";
  const accountLedgerLabel = (id: string | null) => {
    const account = moneyAccounts.find((item) => item.id === id);
    if (!account) return "company money · account unassigned";
    if (account.kind === "personal_custody") return "Swornim Global IME · non-VAT company money";
    if (account.kind === "company_bank") return "Avernek Global IME · VAT company money";
    return account.name;
  };
  const billingLabel = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(
          new Date(`${value.slice(0, 7)}-01T00:00:00Z`)
        )
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Spending ledger"
        title="Expenses"
        subtitle={`${rows.length} transaction${rows.length === 1 ? "" : "s"} shown in ${ledgerLabel}${selectedPerson ? ` for ${selectedPerson.name}` : ""}. Each cost belongs to exactly one money ledger.`}
        action={canManage ? (
          <AddExpense
            categories={categories}
            vendors={vendors}
            users={users}
            moneyAccounts={moneyAccounts}
            clients={clientNames}
            meId={session.sub}
          />
        ) : undefined}
      />

      {shareError && (
        <div
          className="rounded-xl px-4 py-3 mb-4 text-sm"
          style={{ border: "1px solid var(--amber)", color: "var(--amber)" }}
        >
          Expenses are visible, but person splits need the Supabase migration
          <span className="font-medium"> 20260712_add_monthly_shares.sql</span>.
        </div>
      )}

      {showFounderTotals && <div className="mb-4">
        <div className="mb-3">
          <SectionHeader title="Founder/team investment totals" subtitle={
            `${sp.cat || sp.vendor || sp.month ? "Selected filters" : "All time"} · only pre-registration and own-pocket spending; company-money expenses are excluded`
          } />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {totals.map(({ member, assigned, paid }, index) => (
            <a
              key={member.id}
              href={`/expenses?person=${member.id}&basis=share${sp.ledger ? `&ledger=${encodeURIComponent(sp.ledger)}` : ""}${sp.cat ? `&cat=${sp.cat}` : ""}${sp.vendor ? `&vendor=${sp.vendor}` : ""}${sp.month ? `&month=${sp.month}` : ""}`}
              className="card card-interactive p-4"
              style={{
                borderColor:
                  selectedPersonId === member.id && basis === "share"
                    ? "var(--accent)"
                    : "var(--line)",
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="pill !px-2 !py-0.5 tnum">#{index + 1}</span>
                <span className="truncate">{member.name}</span>
              </div>
              <div className="tnum font-semibold mt-1">{npr(assigned)}</div>
              <div className="text-xs muted tnum">paid {npr(paid)}</div>
            </a>
          ))}
        </div>
      </div>}

      {/* Filters */}
      <form className="card p-3 flex flex-wrap gap-2 mb-4 text-sm">
        <select name="ledger" aria-label="Money ledger filter" defaultValue={sp.ledger ?? ""} className="input !w-full sm:!w-auto !h-10">
          <option value="">All expense ledgers</option>
          <option value="founder">Founder/team investment</option>
          <option value="company">All company operating money</option>
          {moneyAccounts.map((account) => (
            <option key={account.id} value={`account:${account.id}`}>
              {account.kind === "personal_custody"
                ? "Swornim Global IME · non-VAT"
                : account.kind === "company_bank"
                  ? "Avernek Global IME · VAT"
                  : account.name}
            </option>
          ))}
        </select>
        <select name="cat" aria-label="Category filter" defaultValue={sp.cat ?? ""} className="input !w-full sm:!w-auto !h-10">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="vendor" aria-label="Vendor filter" defaultValue={sp.vendor ?? ""} className="input !w-[calc(50%-4px)] sm:!w-auto !h-10">
          <option value="">All vendors/types</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
          ))}
        </select>
        <select name="client" aria-label="Client filter" defaultValue={sp.client ?? ""} className="input !w-full sm:!w-auto !h-10">
          <option value="">All clients / projects</option>
          {clientNames.map((client) => (
            <option key={client} value={client}>{client}</option>
          ))}
        </select>
        <select
          name="person"
          defaultValue={selectedPersonId}
          aria-label="Person filter"
          className="input !w-[calc(50%-4px)] sm:!w-auto !h-10"
        >
          <option value="">All people</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select name="basis" aria-label="Allocation basis" defaultValue={basis} className="input !w-[calc(50%-4px)] sm:!w-auto !h-10">
          <option value="share">Investment share</option>
          <option value="paid">Personally paid by</option>
        </select>
        <input
          name="month"
          type="month"
          defaultValue={sp.month ?? ""}
          aria-label="Billing month"
          className="input !w-[calc(50%-4px)] sm:!w-auto !h-10"
        />
        <button className="btn !h-10">Filter</button>
        {(selectedPersonId || sp.ledger || sp.cat || sp.vendor || sp.client || sp.month) && (
          <a href="/expenses" className="btn !h-10">Clear</a>
        )}
        <a href="/api/export" className="btn !h-10">
          Export CSV
        </a>
      </form>

      <div className="card overflow-hidden divide-y" style={{ borderColor: "var(--line)" }}>
        {rows.length === 0 && (
          <EmptyState title="No expenses found" description="Try clearing the filters or add the first expense for this period." icon="expense" />
        )}
        {rows.map((e) => {
          const selectedShareNpr =
            selectedPerson && basis === "share"
              ? assignedShareNpr(e, selectedPerson, users)
              : null;
          const selectedShareOriginal =
            selectedPerson && basis === "share"
              ? assignedShareOriginal(e, selectedPerson, users)
              : null;
          return (
          <div
            key={e.id}
            className="list-row p-4 md:px-5 flex items-center gap-3"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="stat-icon !w-10 !h-10 shrink-0" style={{ color: categories.find((category) => category.id === e.category_id)?.color || "#b8a0fb" }}>
              <Icon name="expense" size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {vendorName(e.vendor_id) || catName(e.category_id)}
                </span>
                {e.currency === "USD" && (
                  <FxBadge source={e.fx_source} status={e.conversion_status} />
                )}
                {e.is_reimbursed && <span className="pill ok">reimbursed</span>}
                {e.funding_source === "company_funds"
                  ? <span className="pill accent">{accountLedgerLabel(e.money_account_id)}</span>
                  : <span className="pill">founder/team investment</span>}
              </div>
              <div className="text-xs muted mt-0.5 truncate">
                {e.expense_date} · {catName(e.category_id)} · {e.funding_source === "company_funds" ? accountName(e.money_account_id) : payerName(e.paid_by_user_id)}
                {e.billing_month ? ` · for ${billingLabel(e.billing_month)}` : ""}
                {e.client ? ` · ${e.client}` : ""}
              </div>
              {!!e.expense_shares?.length && (
                <div className="text-xs muted mt-1 truncate">
                  Split: {e.expense_shares
                    .map(
                      (share) =>
                        `${payerName(share.user_id)} ${e.currency === "USD" ? usd(share.amount) : npr(share.amount)}`
                    )
                    .join(" · ")}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="tnum font-semibold">
                {selectedShareNpr != null
                  ? npr(selectedShareNpr)
                  : e.amount_npr != null
                    ? npr(e.amount_npr)
                    : "—"}
              </div>
              {selectedShareNpr != null ? (
                <div className="tnum text-xs muted">
                  {e.currency === "USD" ? usd(selectedShareOriginal ?? 0) : "individual share"}
                  {" · total "}{e.amount_npr != null ? npr(e.amount_npr) : "—"}
                </div>
              ) : e.currency === "USD" ? (
                <div className="tnum text-xs muted">{usd(e.amount)}</div>
              ) : null}
            </div>
            {canManage && (
              <ExpenseRowActions
                expense={e}
                isReimbursed={e.is_reimbursed}
                pending={e.conversion_status === "pending"}
                categories={categories}
                vendors={vendors}
                users={users}
                moneyAccounts={moneyAccounts}
                clients={clientNames}
              />
            )}
          </div>
          );
        })}
      </div>
    </>
  );
}
