import { query } from "@/lib/db";
import { getSession } from "@/lib/auth/server";
import type { AppUser, Category, Expense, Vendor } from "@/lib/types";

// GET /api/export -> expenses.csv
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const [exp, shareRows, cats, vends, team] = await Promise.all([
    query<Expense>(
      `select * from public.expenses order by expense_date desc`
    ),
    query<{ expense_id: string; user_id: string; amount: number }>(
      `select * from public.expense_shares`
    ),
    query<Category>(`select * from public.categories`),
    query<Vendor>(`select * from public.vendors`),
    query<AppUser>(`select * from public.users`),
  ]);

  const categories = cats as Category[];
  const vendors = vends as Vendor[];
  const users = team as AppUser[];
  const rows = exp.map((expense) => ({
    ...expense,
    expense_shares: shareRows.filter(
      (share) => share.expense_id === expense.id
    ),
  })) as Expense[];

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
