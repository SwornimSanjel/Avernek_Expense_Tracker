import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth/server";
import type { AppUser, Category, Expense, MoneyAccount, Vendor } from "@/lib/types";
import { expenseWhere, type ExpenseSearch } from "@/lib/expense-filters";
import { assignedShareNpr } from "@/lib/individual";
import { USER_COLUMNS } from "@/lib/people";
import { accountLabel } from "@/lib/statement";
import { csvMoney, csvResponse, fileSlug, type CsvCell } from "@/lib/csv";

// GET /api/export?<expense filters> -> expenses CSV, exactly what the Expenses
// page shows, with plain column names and a total at the bottom.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries()) as ExpenseSearch;
  // An export link without filters keeps its old meaning: everything.
  if (![...request.nextUrl.searchParams.keys()].length) sp.period = "all";
  const accountRows = await query<{ id: string }>(`select id from public.money_accounts`);
  const { where, params, range } = expenseWhere(sp, accountRows.map((row) => row.id));

  const [expenses, shareRows, categories, vendors, users, accounts, billCounts] = await Promise.all([
    query<Expense>(
      `select e.* from public.expenses e
         left join public.vendors v on v.id = e.vendor_id
         left join public.categories c on c.id = e.category_id
       ${where}
       order by e.expense_date desc, e.created_at desc`,
      params
    ),
    query<{ expense_id: string; user_id: string; amount: number; amount_npr: number | null }>(
      `select expense_id, user_id, amount, amount_npr from public.expense_shares`
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

  const sharesByExpense = new Map<string, typeof shareRows>();
  for (const share of shareRows) {
    const list = sharesByExpense.get(share.expense_id) ?? [];
    list.push(share);
    sharesByExpense.set(share.expense_id, list);
  }
  const billsByExpense = new Map(billCounts.map((row) => [row.expense_id, Number(row.bills)]));
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const vendorById = new Map(vendors.map((row) => [row.id, row]));
  const userById = new Map(users.map((row) => [row.id, row]));
  const accountById = new Map(accounts.map((row) => [row.id, row]));

  const allRows = expenses.map((expense) => ({ ...expense, expense_shares: sharesByExpense.get(expense.id) ?? [] })) as Expense[];
  const person = users.find((user) => user.id === (sp.person ?? sp.payer));
  const paidBasis = sp.basis === "paid" || Boolean(sp.payer && !sp.basis);
  const shareBasis = Boolean(person) && !paidBasis;
  const rows = !person
    ? allRows
    : allRows.filter((expense) =>
        paidBasis
          ? expense.funding_source !== "company_funds" && expense.paid_by_user_id === person.id
          : assignedShareNpr(expense, person, users) > 0
      );

  const header = [
    "Date",
    "Description",
    "Category",
    "Vendor",
    "Client / project",
    "Paid from",
    "Paid by",
    "Split",
    shareBasis ? `${person!.name}'s share (NPR)` : "Amount (NPR)",
    ...(shareBasis ? ["Full amount (NPR)"] : []),
    "Original amount",
    "Bill",
    "Bill number",
    "PAN / VAT no.",
    "Bill photo",
    "Reimbursed",
  ];

  let total = 0;
  const lines: CsvCell[][] = rows.map((expense) => {
    const category = categoryById.get(expense.category_id ?? "");
    const vendor = vendorById.get(expense.vendor_id ?? "");
    const company = expense.funding_source === "company_funds";
    const account = accountById.get(expense.money_account_id ?? "");
    const amount = shareBasis ? assignedShareNpr(expense, person!, users) : Number(expense.amount_npr ?? 0);
    total += amount;
    const photos = billsByExpense.get(expense.id) ?? 0;
    return [
      expense.expense_date.slice(0, 10),
      expense.note && vendor ? expense.note : vendor?.name || expense.note || category?.name || "Expense",
      category?.name ?? "Uncategorised",
      vendor?.name ?? "",
      expense.client ?? "",
      company ? (account ? accountLabel(account) : "Company money") : "Founder money",
      company ? "" : userById.get(expense.paid_by_user_id ?? "")?.name ?? "",
      company
        ? ""
        : (expense.expense_shares ?? [])
            .map((share) => `${userById.get(share.user_id)?.name ?? "Someone"} ${Number(share.amount).toFixed(2)}`)
            .join("; "),
      expense.amount_npr == null ? "" : csvMoney(amount),
      ...(shareBasis ? [csvMoney(expense.amount_npr)] : []),
      expense.currency === "NPR" ? "" : `${expense.currency} ${Number(expense.amount).toFixed(2)}`,
      expense.has_bill === true ? "Yes" : expense.has_bill === false ? "No" : "",
      expense.bill_number ?? "",
      expense.seller_pan ?? "",
      photos ? `Yes (${photos})` : "No",
      company ? "" : expense.is_reimbursed ? "Yes" : "No",
    ];
  });

  const totalRow: CsvCell[] = header.map(() => "");
  totalRow[0] = "Total";
  totalRow[1] = `${rows.length} expense${rows.length === 1 ? "" : "s"}`;
  totalRow[header.indexOf(shareBasis ? `${person!.name}'s share (NPR)` : "Amount (NPR)")] = csvMoney(total);
  if (rows.length) lines.push([], totalRow);

  return csvResponse(`avernek-expenses-${fileSlug(range.label)}.csv`, header, lines);
}
