import { createClient } from "@/lib/supabase/server";
import { PageHeader, FxBadge } from "@/components/ui";
import AddExpense from "@/components/AddExpense";
import { npr, usd } from "@/lib/format";
import type { AppUser, Category, Expense, Vendor } from "@/lib/types";
import ExpenseRowActions from "@/components/ExpenseRowActions";
import {
  assignedShareNpr,
  assignedShareOriginal,
  computeIndividualSpending,
} from "@/lib/individual";
import { canManageExpenses } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    payer?: string;
    person?: string;
    basis?: "share" | "paid";
    month?: string;
    vendor?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canManage = canManageExpenses(user?.email);

  const [{ data: cats }, { data: vends }, { data: team }] = await Promise.all([
    supabase.from("categories").select("*").order("name"),
    supabase.from("vendors").select("*").order("name"),
    supabase.from("users").select("*").order("name"),
  ]);

  let query = supabase
    .from("expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .limit(1000);
  if (sp.cat) query = query.eq("category_id", sp.cat);
  if (sp.vendor) query = query.eq("vendor_id", sp.vendor);
  if (/^\d{4}-\d{2}$/.test(sp.month ?? "")) {
    query = query.eq("billing_month", `${sp.month}-01`);
  }
  const [
    { data: expenses },
    { data: shareRows, error: shareError },
  ] = await Promise.all([
    query,
    supabase.from("expense_shares").select("*"),
  ]);

  const categories = (cats ?? []) as Category[];
  const vendors = (vends ?? []) as Vendor[];
  const users = (team ?? []) as AppUser[];
  const sourceRows = (expenses ?? []).map((expense) => ({
    ...expense,
    expense_shares: (shareRows ?? []).filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];
  const selectedPersonId = sp.person ?? sp.payer ?? "";
  const basis = sp.basis ?? (sp.payer ? "paid" : "share");
  const selectedPerson = users.find((member) => member.id === selectedPersonId) ?? null;

  const totals = computeIndividualSpending(users, sourceRows);
  const rows = !selectedPerson
    ? sourceRows
    : sourceRows.filter((expense) =>
        basis === "paid"
          ? expense.paid_by_user_id === selectedPerson.id
          : assignedShareNpr(expense, selectedPerson, users) > 0
      );

  const catName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "—";
  const vendorName = (id: string | null) =>
    vendors.find((v) => v.id === id)?.name ?? "";
  const payerName = (id: string | null) =>
    users.find((u) => u.id === id)?.name.split(" ")[0] ?? "—";
  const billingLabel = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(
          new Date(`${value.slice(0, 7)}-01T00:00:00Z`)
        )
      : null;

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle={`${rows.length} shown${selectedPerson ? ` for ${selectedPerson.name}` : ""}`}
        action={
          <AddExpense
            categories={categories}
            vendors={vendors}
            users={users}
            meId={user!.id}
          />
        }
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

      <div className="mb-4">
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <h2 className="text-sm font-semibold">Individual totals</h2>
            <p className="text-xs muted">
              {sp.cat || sp.vendor || sp.month ? "For the selected filters" : "All time"} · assigned share vs cash paid
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {totals.map(({ member, assigned, paid }, index) => (
            <a
              key={member.id}
              href={`/expenses?person=${member.id}&basis=share${sp.cat ? `&cat=${sp.cat}` : ""}${sp.vendor ? `&vendor=${sp.vendor}` : ""}${sp.month ? `&month=${sp.month}` : ""}`}
              className="card p-3 hover:opacity-80"
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
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 mb-4 text-sm">
        <select name="cat" defaultValue={sp.cat ?? ""} className="input !w-auto !h-10">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="vendor" defaultValue={sp.vendor ?? ""} className="input !w-auto !h-10">
          <option value="">All vendors/types</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
          ))}
        </select>
        <select
          name="person"
          defaultValue={selectedPersonId}
          className="input !w-auto !h-10"
        >
          <option value="">All people</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select name="basis" defaultValue={basis} className="input !w-auto !h-10">
          <option value="share">Individual share</option>
          <option value="paid">Paid by</option>
        </select>
        <input
          name="month"
          type="month"
          defaultValue={sp.month ?? ""}
          aria-label="Billing month"
          className="input !w-auto !h-10"
        />
        <button className="btn !h-10">Filter</button>
        {(selectedPersonId || sp.cat || sp.vendor || sp.month) && (
          <a href="/expenses" className="btn !h-10">Clear</a>
        )}
        <a href="/api/export" className="btn !h-10">
          Export CSV
        </a>
      </form>

      <div className="card divide-y" style={{ borderColor: "var(--line)" }}>
        {rows.length === 0 && (
          <div className="p-8 text-center muted">
            No expenses yet. Tap "+ Add expense".
          </div>
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
            className="p-4 flex items-center gap-3"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {vendorName(e.vendor_id) || catName(e.category_id)}
                </span>
                {e.currency === "USD" && (
                  <FxBadge source={e.fx_source} status={e.conversion_status} />
                )}
                {e.is_reimbursed && <span className="pill ok">reimbursed</span>}
              </div>
              <div className="text-xs muted mt-0.5 truncate">
                {e.expense_date} · {catName(e.category_id)} · {payerName(e.paid_by_user_id)}
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
              />
            )}
          </div>
          );
        })}
      </div>
    </>
  );
}
