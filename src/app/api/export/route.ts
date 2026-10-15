import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth/server";
import type { AppUser, Category, Expense, MoneyAccount, Vendor } from "@/lib/types";
import { expenseWhere, type ExpenseSearch } from "@/lib/expense-filters";
import { assignedShareNpr } from "@/lib/individual";
import { USER_COLUMNS } from "@/lib/people";

// GET /api/export?<expense filters> -> expenses.csv, exactly what the Expenses page shows.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries()) as ExpenseSearch;
  // An export link without filters keeps its old meaning: everything.
  if (![...request.nextUrl.searchParams.keys()].length) sp.period = "all";
  const accountRows = await query<{ id: string }>(`select id from public.money_accounts`);
  const { where, params } = expenseWhere(sp, accountRows.map((row) => row.id));

  const [exp, shareRows, cats, vends, team, accounts, billCounts] = await Promise.all([
    query<Expense>(
      `select e.* from public.expenses e
         left join public.vendors v on v.id = e.vendor_id
         left join public.categories c on c.id = e.category_id
       ${where}
       order by e.expense_date desc, e.created_at desc`,
      params
    ),
    query<{ expense_id: string; user_id: string; amount: number }>(
      `select * from public.expense_shares`
    ),
    query<Category>(`select * from public.categories`),
    query<Vendor>(`select * from public.vendors`),
    query<AppUser>(`select ${USER_COLUMNS} from public.users`),
    query<MoneyAccount>(`select * from public.money_accounts`),
    query<{ expense_id: string; bills: string }>(
      `select expense_id, count(*) as bills from public.attachments
        where kind = 'expense_bill' group by expense_id`
    ),
  ]);
  const billsByExpense = new Map(billCounts.map((row) => [row.expense_id, Number(row.bills)]));

  const categories = cats as Category[];
  const vendors = vends as Vendor[];
  const users = team as AppUser[];
  const allRows = exp.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];
  const person = users.find((user) => user.id === (sp.person ?? sp.payer));
  const paidBasis = sp.basis === "paid" || (sp.payer && !sp.basis);
  const rows = !person
    ? allRows
    : allRows.filter((expense) =>
        paidBasis
          ? expense.funding_source !== "company_funds" && expense.paid_by_user_id === person.id
          : assignedShareNpr(expense, person, users) > 0
      );

  const name = <T extends { id: string; name: string }>(
    list: T[],
    id: string | null
  ) => list.find((x) => x.id === id)?.name ?? "";

  const header = [
    "date",
    "billing_month",
    "vendor",
    "category",
    "paid_by",
    "funding_source",
    "money_account",
    "client",
    "amount",
    "currency",
    "fx_rate_to_npr",
    "fx_source",
    "fx_rate_date",
    "conversion_status",
    "actual_npr_charged",
    "amount_npr",
    "is_reimbursed",
    "note",
    "shares",
    "bills_attached",
  ];

  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [header.join(",")];
  for (const e of rows) {
    lines.push(
      [
        e.expense_date,
        e.billing_month?.slice(0, 7) ?? "",
        name(vendors, e.vendor_id),
        name(categories, e.category_id),
        name(users, e.paid_by_user_id),
        e.funding_source,
        name(accounts, e.money_account_id),
        e.client ?? "",
        e.amount,
        e.currency,
        e.fx_rate_to_npr,
        e.fx_source,
        e.fx_rate_date ?? "",
        e.conversion_status,
        e.actual_npr_charged ?? "",
        e.amount_npr ?? "",
        e.is_reimbursed,
        e.note ?? "",
        (e.expense_shares ?? [])
          .map((share) => `${name(users, share.user_id)}: ${share.amount} ${e.currency}`)
          .join("; "),
        billsByExpense.get(e.id) ?? 0,
      ]
        .map(escape)
        .join(",")
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="avernek-expenses-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
