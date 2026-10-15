import { query } from "@/lib/db";
import { getCachedUsdSellRate } from "@/lib/fx";
import { summarizeIncomeAgreement, type IncomeAgreementSummary } from "@/lib/income";
import { loadLedger } from "@/lib/ledger";
import type {
  AppUser,
  Category,
  Expense,
  ExpenseShare,
  IncomeAgreement,
  IncomePayment,
  MoneyAccount,
  Recurring,
  Vendor,
} from "@/lib/types";

/** A client as people talk about it: one name, one or more agreements. */
export type Client = { name: string; agreements: IncomeAgreement[] };

/**
 * The rows the assistant's tools read, loaded with the same queries the pages
 * use and at most once per request, however many tools the request calls.
 */
export class RequestData {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(readonly today: string) {}

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key) as Promise<T>;
  }

  expenses() {
    return this.once("expenses", () =>
      query<Expense>(`select * from public.expenses order by expense_date desc, created_at desc`)
    );
  }

  expenseShares() {
    return this.once("expenseShares", () => query<ExpenseShare>(`select * from public.expense_shares`));
  }

  categories() {
    return this.once("categories", () => query<Category>(`select * from public.categories order by name`));
  }

  vendors() {
    return this.once("vendors", () => query<Vendor>(`select * from public.vendors order by name`));
  }

  users() {
    return this.once("users", () =>
      query<AppUser>(`select id, name, email, is_core_member, is_admin from public.users order by name`)
    );
  }

  moneyAccounts() {
    return this.once("moneyAccounts", () =>
      query<MoneyAccount>(`select * from public.money_accounts where is_active = true order by currency, name`)
    );
  }

  /** Every account, closed ones included: old receipts still need their currency. */
  allMoneyAccounts() {
    return this.once("allMoneyAccounts", () => query<MoneyAccount>(`select * from public.money_accounts order by name`));
  }

  subscriptions() {
    return this.once("subscriptions", () =>
      query<Recurring>(`select * from public.recurring where is_active = true order by next_renewal_date`)
    );
  }

  agreements() {
    return this.once("agreements", () =>
      query<IncomeAgreement>(
        `select * from public.income_agreements
          order by case status when 'active' then 0 when 'paused' then 1 else 2 end, client_name`
      )
    );
  }

  payments() {
    return this.once("payments", () =>
      query<IncomePayment>(`select * from public.income_payments order by paid_on desc, created_at desc`)
    );
  }

  /** summarizeIncomeAgreement for every agreement, as the Clients page computes it. */
  summaries(): Promise<Map<string, IncomeAgreementSummary>> {
    return this.once("summaries", async () => {
      const [agreements, payments] = await Promise.all([this.agreements(), this.payments()]);
      return new Map(
        agreements.map((agreement) => [agreement.id, summarizeIncomeAgreement(agreement, payments, this.today)])
      );
    });
  }

  clients(): Promise<Client[]> {
    return this.once("clients", async () => {
      const byName = new Map<string, Client>();
      for (const agreement of await this.agreements()) {
        const key = agreement.client_name.trim().toLowerCase();
        const client = byName.get(key) ?? { name: agreement.client_name.trim(), agreements: [] };
        client.agreements.push(agreement);
        byName.set(key, client);
      }
      return [...byName.values()];
    });
  }

  ledger() {
    return this.once("ledger", () => loadLedger());
  }

  usdRate() {
    return this.once("usdRate", () => getCachedUsdSellRate());
  }
}
