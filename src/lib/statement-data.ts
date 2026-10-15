import { query } from "@/lib/db";
import { loadLedger, type Ledger } from "@/lib/ledger";
import { buildStatementEvents, statementAccounts } from "@/lib/statement";
import type { Category, Expense, Vendor } from "@/lib/types";

/** Everything a statement needs, from one ledger load plus lookups. */
export async function loadStatement(existing?: Ledger) {
  const [ledger, founderExpenses, agreements, categories, vendors] = await Promise.all([
    existing ?? loadLedger(),
    query<Expense>(
      `select * from public.expenses where funding_source <> 'company_funds'
        order by expense_date desc, created_at desc`
    ),
    query<{ id: string; client_name: string }>(`select id, client_name from public.income_agreements`),
    query<Pick<Category, "id" | "name">>(`select id, name from public.categories`),
    query<Pick<Vendor, "id" | "name">>(`select id, name from public.vendors`),
  ]);

  const events = buildStatementEvents({
    ledger,
    founderExpenses,
    clientNames: new Map(agreements.map((row) => [row.id, row.client_name])),
    categoryNames: new Map(categories.map((row) => [row.id, row.name])),
    vendorNames: new Map(vendors.map((row) => [row.id, row.name])),
  });

  return { ledger, events, accounts: statementAccounts(ledger.accounts), founderExpenses };
}
