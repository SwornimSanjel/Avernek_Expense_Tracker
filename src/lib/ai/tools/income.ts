import { z } from "zod";
import { expenseTotals, expensesInRange, monthKey } from "@/lib/expense-summary";
import { moneyAccountKindLabel } from "@/lib/funds";
import { servicesLabel } from "@/lib/income";
import { fromPaisa, toPaisa } from "@/lib/money";
import type { IncomePayment, OtherIncome } from "@/lib/types";
import { formatDate, formatMonth } from "../dates";
import { money, moneyByCurrency, plural } from "../format";
import type { Card } from "../types";
import { clean, dateRange, explain, firstIssue, isoDate, rangeText } from "./common";
import { taxTotals } from "./clients";
import type { ReadTool, ToolContext } from "./types";

/**
 * Income follows the app's tax rules (lib/tax.ts): a receipt's `amount` is the
 * bill excluding VAT and is Avernek's gross income; VAT is collected for the
 * IRD on top of it; TDS is withheld by the client and is a tax credit. So
 * gross income = Σ amount, and the bank received amount + VAT − TDS.
 */

type Receipt = {
  source: "client" | "other";
  currency: string;
  date: string;
  group: string;
  amount: IncomePayment["amount"];
  vat_amount: IncomePayment["vat_amount"];
  tds_amount: IncomePayment["tds_amount"];
};

async function receiptsIn(ctx: ToolContext, from?: string, before?: string): Promise<Receipt[]> {
  const [ledger, agreements, accounts] = await Promise.all([
    ctx.data.ledger(),
    ctx.data.agreements(),
    ctx.data.allMoneyAccounts(),
  ]);
  const agreement = new Map(agreements.map((item) => [item.id, item]));
  const account = new Map(accounts.map((item) => [item.id, item]));
  const inRange = (date: string) => (!from || date >= from) && (!before || date < before);

  const fromClients: Receipt[] = ledger.payments
    .filter((payment) => inRange(payment.paid_on))
    .map((payment) => ({
      source: "client",
      currency: agreement.get(payment.agreement_id)?.currency ?? "NPR",
      date: payment.paid_on,
      group: agreement.get(payment.agreement_id)?.client_name ?? "Unknown client",
      amount: payment.amount,
      vat_amount: payment.vat_amount,
      tds_amount: payment.tds_amount,
    }));
  const other: Receipt[] = (ledger.otherIncome as OtherIncome[])
    .filter((row) => inRange(row.received_on))
    .map((row) => ({
      source: "other",
      currency: account.get(row.money_account_id)?.currency ?? "NPR",
      date: row.received_on,
      group: row.source_name || row.description || "Other income",
      amount: row.amount,
      vat_amount: row.vat_amount,
      tds_amount: row.tds_amount,
    }));
  return [...fromClients, ...other];
}

function currencies(receipts: Receipt[]): string[] {
  return [...new Set(receipts.map((receipt) => receipt.currency))].sort((a, b) =>
    a === "NPR" ? -1 : b === "NPR" ? 1 : a.localeCompare(b)
  );
}

/** The VAT & TDS table: client payments, other income and the total, per currency. */
function taxTable(receipts: Receipt[]): Card {
  const rows: Record<string, string>[] = [];
  for (const currency of currencies(receipts)) {
    const suffix = currencies(receipts).length > 1 ? ` (${currency})` : "";
    const lines: [string, Receipt[]][] = [
      ["Client payments", receipts.filter((r) => r.currency === currency && r.source === "client")],
      ["Other income", receipts.filter((r) => r.currency === currency && r.source === "other")],
      ["Total", receipts.filter((r) => r.currency === currency)],
    ];
    for (const [label, list] of lines) {
      if (label !== "Total" && !list.length) continue;
      const t = taxTotals(list);
      rows.push({
        what: `${label}${suffix}`,
        gross: money(t.gross, currency),
        vat: money(t.vat, currency),
        tds: money(t.tds, currency),
        bank: money(t.bank, currency),
      });
    }
  }
  return {
    type: "table",
    title: "VAT & TDS",
    columns: [
      { key: "what", label: "" },
      { key: "gross", label: "Gross (excl. VAT)", align: "right" },
      { key: "vat", label: "VAT collected", align: "right" },
      { key: "tds", label: "TDS withheld", align: "right" },
      { key: "bank", label: "Reached the bank", align: "right" },
    ],
    rows,
    note: "VAT is collected for the IRD and is not Avernek's income. TDS was withheld by clients: it is a tax credit, not lost income.",
  };
}

const incomeSchema = z.object({
  from: isoDate.optional().describe("First day included; omit with `to` for all time"),
  to: isoDate.optional(),
  group_by: z.enum(["none", "month", "client", "source"]).optional(),
  explain,
});

export const getIncomeSummary: ReadTool = {
  name: "get_income_summary",
  label: "Income summary",
  kind: "read",
  permission: "member",
  description:
    "Gross income (client payments plus other income, excluding VAT) for a period, with a separate VAT & TDS breakdown and what reached the bank; optionally by month, client or source. Capital and loans are not income. Use for 'total income', 'revenue this month', 'monthly revenue', 'how much VAT/TDS'.",
  schema: incomeSchema,
  async run(raw, ctx) {
    const parsed = incomeSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const range = dateRange(parsed.data.from, parsed.data.to);
    if (typeof range === "string") return { status: "error", summary: range };
    const receipts = await receiptsIn(ctx, range.from, range.before);
    const when = rangeText(range.from, range.to);

    const gross = new Map<string, number>();
    const totals = currencies(receipts).map((currency) => {
      const list = receipts.filter((receipt) => receipt.currency === currency);
      const t = taxTotals(list);
      gross.set(currency, t.gross);
      return {
        currency,
        ...t,
        client_payments: taxTotals(list.filter((r) => r.source === "client")).gross,
        other_income: taxTotals(list.filter((r) => r.source === "other")).gross,
        receipts: list.length,
      };
    });

    const cards: Card[] = [
      {
        type: "stats",
        items: totals.length
          ? totals.map((t) => ({
              label: `Gross income${totals.length > 1 ? ` (${t.currency})` : ""}`,
              value: money(t.gross, t.currency),
              hint: `${plural(t.receipts, "receipt")} · ${when} · excl. VAT`,
              tone: "good" as const,
            }))
          : [{ label: "Gross income", value: money(0), hint: when }],
      },
    ];
    if (receipts.length) cards.push(taxTable(receipts));

    const by = parsed.data.group_by ?? "none";
    if (by !== "none" && receipts.length) {
      const groups = new Map<string, { currency: string; label: string; paisa: number }>();
      for (const receipt of receipts) {
        const label =
          by === "month" ? monthKey(receipt.date) : by === "client" ? receipt.group : receipt.source === "client" ? "Client payments" : "Other income";
        const key = `${receipt.currency}|${label}`;
        const group = groups.get(key) ?? { currency: receipt.currency, label, paisa: 0 };
        group.paisa += toPaisa(receipt.amount);
        groups.set(key, group);
      }
      const list = [...groups.values()].sort((a, b) =>
        by === "month" ? a.label.localeCompare(b.label) : b.paisa - a.paisa
      );
      cards.push({
        type: "table",
        title: by === "month" ? "By month" : by === "client" ? "By client" : "By source",
        columns: [
          { key: "name", label: by === "month" ? "Month" : "Name" },
          { key: "amount", label: "Gross (excl. VAT)", align: "right" },
        ],
        rows: list.slice(0, 24).map((group) => ({
          name: by === "month" ? formatMonth(group.label) : group.label,
          amount: money(fromPaisa(group.paisa), group.currency),
        })),
      });
    }

    const lines = totals.map(
      (t) =>
        `${money(t.gross, t.currency)} (client payments ${money(t.client_payments, t.currency)}, other income ${money(t.other_income, t.currency)}); VAT collected ${money(t.vat, t.currency)}, TDS withheld ${money(t.tds, t.currency)}, ${money(t.bank, t.currency)} reached the bank`
    );
    return {
      status: "ok",
      summary: totals.length
        ? `Gross income ${when}: ${lines.join("; and ")}.`
        : `No income was recorded ${when}.`,
      cards,
      data: { from: range.from ?? null, to: range.to ?? null, totals },
    };
  },
};

// ---------------------------------------------------------------------------

export const getRecurringRevenue: ReadTool = {
  name: "get_recurring_revenue",
  label: "Recurring revenue",
  kind: "read",
  permission: "member",
  description:
    "Monthly recurring revenue from active clients (ads, automation and other monthly fees), per client and in total. Use for 'recurring revenue', 'monthly retainers', 'MRR'.",
  schema: z.object({}),
  async run(_raw, ctx) {
    const [agreements, summaries] = await Promise.all([ctx.data.agreements(), ctx.data.summaries()]);
    // Active agreements only, as the Clients page's recurring total.
    const rows = agreements
      .filter((agreement) => agreement.status === "active")
      .map((agreement) => ({ agreement, summary: summaries.get(agreement.id)! }))
      .filter(({ summary }) => summary.recurring.monthlyTotal > 0)
      .sort((a, b) => b.summary.recurring.monthlyTotal - a.summary.recurring.monthlyTotal);
    const totals = new Map<string, number>();
    for (const { agreement, summary } of rows) {
      totals.set(
        agreement.currency,
        fromPaisa(toPaisa(totals.get(agreement.currency) ?? 0) + toPaisa(summary.recurring.monthlyTotal))
      );
    }
    return {
      status: "ok",
      summary: rows.length
        ? `${plural(rows.length, "active client")} pay ${moneyByCurrency(totals)} a month in recurring fees.`
        : "No active client has a monthly fee.",
      cards: rows.length
        ? [
            {
              type: "stats",
              items: [...totals.entries()].map(([currency, amount]) => ({
                label: `Monthly recurring${totals.size > 1 ? ` (${currency})` : ""}`,
                value: money(amount, currency),
                hint: "Active clients, excl. VAT",
                tone: "good" as const,
              })),
            },
            {
              type: "table",
              title: "Monthly fees by client",
              columns: [
                { key: "client", label: "Client" },
                { key: "services", label: "Services" },
                { key: "monthly", label: "Per month", align: "right" },
                { key: "next", label: "Next due" },
              ],
              rows: rows.map(({ agreement, summary }) => ({
                client: agreement.client_name,
                services: servicesLabel(agreement),
                monthly: money(summary.recurring.monthlyTotal, agreement.currency),
                next: summary.recurring.nextDueDate ? formatDate(summary.recurring.nextDueDate) : "—",
              })),
            },
          ]
        : [{ type: "notice", tone: "info", text: "No recurring fees." }],
      data: {
        totals: Object.fromEntries(totals),
        clients: rows.map(({ agreement, summary }) => ({
          client: agreement.client_name,
          currency: agreement.currency,
          monthly: summary.recurring.monthlyTotal,
        })),
      },
    };
  },
};

// ---------------------------------------------------------------------------

export const getTaxPosition: ReadTool = {
  name: "get_tax_position",
  label: "VAT & TDS position",
  kind: "read",
  permission: "member",
  description:
    "Avernek's current VAT and TDS position, all time, as on the Funds and VAT pages: VAT collected (output), VAT paid on bills (input), VAT deposited, VAT still owed or carried forward, and TDS credit. Use for 'how much VAT do we owe', 'TDS credit'.",
  schema: z.object({}),
  async run(_raw, ctx) {
    const { tax } = await ctx.data.ledger();
    return {
      status: "ok",
      summary: `VAT owed to the IRD is about ${money(tax.vatOwed)}${tax.vatCarryForward > 0 ? ` (with ${money(tax.vatCarryForward)} to carry forward)` : ""}; the TDS credit is ${money(tax.tdsCredit)}. This is an estimate from the books, not a tax return.`,
      cards: [
        {
          type: "stats",
          items: [
            { label: "VAT owed", value: money(tax.vatOwed), tone: tax.vatOwed > 0 ? "warn" : "default" },
            { label: "TDS credit", value: money(tax.tdsCredit), tone: "good" },
          ],
        },
        {
          type: "facts",
          title: "VAT & TDS, all time",
          items: [
            { label: "VAT collected (output)", value: money(tax.outputVat) },
            { label: "VAT on bills (input)", value: money(tax.inputVat) },
            { label: "VAT deposited", value: money(tax.vatDeposited) },
            { label: "VAT owed", value: money(tax.vatOwed) },
            ...(tax.vatCarryForward > 0 ? [{ label: "VAT carried forward", value: money(tax.vatCarryForward) }] : []),
            { label: "TDS withheld by clients (credit)", value: money(tax.tdsCredit) },
          ],
          note: "An estimate from the books, as on the VAT page; not a tax return.",
        },
      ],
      data: tax,
    };
  },
};

// ---------------------------------------------------------------------------

export const getAccountBalances: ReadTool = {
  name: "get_account_balances",
  label: "Account balances",
  kind: "read",
  permission: "member",
  description:
    "Current balance of each company money account (bank, custody, wallet, cash), the VAT reserved in it and what is free to spend, as on the Funds page. Use for 'bank balance', 'how much money do we have'.",
  schema: z.object({}),
  async run(_raw, ctx) {
    const { balances } = await ctx.data.ledger();
    const totals = new Map<string, number>();
    const free = new Map<string, number>();
    for (const row of balances) {
      totals.set(row.account.currency, fromPaisa(toPaisa(totals.get(row.account.currency) ?? 0) + toPaisa(row.balance)));
      free.set(row.account.currency, fromPaisa(toPaisa(free.get(row.account.currency) ?? 0) + toPaisa(row.free)));
    }
    return {
      status: "ok",
      summary: balances.length
        ? `Company accounts hold ${moneyByCurrency(totals)}, of which ${moneyByCurrency(free)} is free to spend after the VAT reserve.`
        : "There are no active company accounts.",
      cards: balances.length
        ? [
            {
              type: "table",
              title: "Account balances",
              columns: [
                { key: "account", label: "Account" },
                { key: "kind", label: "Type" },
                { key: "balance", label: "Balance", align: "right" },
                { key: "vat", label: "VAT reserved", align: "right" },
                { key: "free", label: "Free", align: "right" },
              ],
              rows: balances.map((row) => ({
                account: row.account.name,
                kind: moneyAccountKindLabel(row.account).split(" · ")[0],
                balance: money(row.balance, row.account.currency),
                vat: row.vatReserved ? money(row.vatReserved, row.account.currency) : "—",
                free: money(row.free, row.account.currency),
              })),
            },
          ]
        : [{ type: "notice", tone: "info", text: "No active accounts." }],
      data: balances.map((row) => ({
        account: row.account.name,
        currency: row.account.currency,
        balance: row.balance,
        vat_reserved: row.vatReserved,
        free: row.free,
      })),
    };
  },
};

// ---------------------------------------------------------------------------

const financialSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  explain,
});

export const getFinancialSummary: ReadTool = {
  name: "get_financial_summary",
  label: "Financial summary",
  kind: "read",
  permission: "member",
  description:
    "Overall picture for a period: gross income, expenses, income minus expenses (NPR), plus today's account balances and money due from clients. Use for 'how are we doing', 'profit this month', 'financial summary'.",
  schema: financialSchema,
  async run(raw, ctx) {
    const parsed = financialSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const range = dateRange(parsed.data.from, parsed.data.to);
    if (typeof range === "string") return { status: "error", summary: range };
    const [receipts, expenses, ledger, agreements, summaries] = await Promise.all([
      receiptsIn(ctx, range.from, range.before),
      ctx.data.expenses(),
      ctx.data.ledger(),
      ctx.data.agreements(),
      ctx.data.summaries(),
    ]);

    const incomeNpr = taxTotals(receipts.filter((r) => r.currency === "NPR")).gross;
    const incomeOther = currencies(receipts)
      .filter((currency) => currency !== "NPR")
      .map((currency) => ({ currency, gross: taxTotals(receipts.filter((r) => r.currency === currency)).gross }));
    const spent = expenseTotals(expensesInRange(expenses, range));
    const net = fromPaisa(toPaisa(incomeNpr) - toPaisa(spent.totalNpr));
    const balances = new Map<string, number>();
    for (const row of ledger.balances) {
      balances.set(row.account.currency, fromPaisa(toPaisa(balances.get(row.account.currency) ?? 0) + toPaisa(row.balance)));
    }
    const dueNow = new Map<string, number>();
    for (const agreement of agreements) {
      const value = summaries.get(agreement.id)!.totalDueNow;
      dueNow.set(agreement.currency, fromPaisa(toPaisa(dueNow.get(agreement.currency) ?? 0) + toPaisa(value)));
    }
    const when = rangeText(range.from, range.to);

    return {
      status: "ok",
      summary: `${when[0].toUpperCase()}${when.slice(1)}: gross income ${money(incomeNpr)}${incomeOther.length ? ` plus ${incomeOther.map((i) => money(i.gross, i.currency)).join(", ")}` : ""}, expenses ${money(spent.totalNpr)}, so income minus expenses is ${money(net)} (NPR only). Accounts now hold ${moneyByCurrency(balances)}; ${moneyByCurrency(dueNow)} is due from clients.`,
      cards: [
        {
          type: "stats",
          title: `Period · ${when}`,
          items: [
            { label: "Gross income", value: money(incomeNpr), hint: incomeOther.length ? `plus ${incomeOther.map((i) => money(i.gross, i.currency)).join(", ")}` : "excl. VAT", tone: "good" },
            { label: "Expenses", value: money(spent.totalNpr), hint: plural(spent.count, "expense") },
            { label: "Income − expenses", value: money(net), hint: "NPR only", tone: net >= 0 ? "good" : "bad" },
          ],
        },
        {
          type: "stats",
          title: "Today",
          items: [
            { label: "In company accounts", value: moneyByCurrency(balances) },
            { label: "Due from clients", value: moneyByCurrency(dueNow), tone: "warn" },
          ],
        },
        ...(spent.unconvertedCount
          ? [{ type: "notice" as const, tone: "warn" as const, text: `${plural(spent.unconvertedCount, "USD expense")} still need an exchange rate and are not in the expense total.` }]
          : []),
      ],
      data: {
        from: range.from ?? null,
        to: range.to ?? null,
        gross_income_npr: incomeNpr,
        gross_income_other: incomeOther,
        expenses_npr: spent.totalNpr,
        income_minus_expenses_npr: net,
        balances: Object.fromEntries(balances),
        due_from_clients: Object.fromEntries(dueNow),
      },
    };
  },
};
