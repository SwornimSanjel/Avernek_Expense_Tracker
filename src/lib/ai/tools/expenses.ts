import { z } from "zod";
import { format, addMonths, startOfMonth } from "date-fns";
import {
  expenseTotals,
  expensesInRange,
  groupExpenses,
  monthKey,
  projectedRenewalsNpr,
  type ExpenseGroup,
} from "@/lib/expense-summary";
import { fromPaisa, toPaisa } from "@/lib/money";
import type { AppUser, Category, Expense, Vendor } from "@/lib/types";
import { formatDate, formatMonth } from "../dates";
import { normalizeName } from "../match";
import { money, plural, truncate } from "../format";
import type { Card } from "../types";
import { clean, dateRange, explain, firstIssue, isoDate, rangeText, resolveRecord } from "./common";
import type { ReadTool, ToolAsk, ToolContext } from "./types";

const funding = z
  .enum(["personal", "company_funds"])
  .describe("personal = paid by a team member (founder/team money); company_funds = paid from a company account");

const filters = {
  category: z.string().max(80).optional().describe("Category name, e.g. Hosting"),
  vendor: z.string().max(80).optional().describe("Vendor name, e.g. OpenAI (GPT)"),
  funding: funding.optional(),
  client: z.string().max(120).optional().describe("Client the expense was for (the expense's client tag)"),
};

type Lookups = { categories: Category[]; vendors: Vendor[]; users: AppUser[] };

async function lookups(ctx: ToolContext): Promise<Lookups> {
  const [categories, vendors, users] = await Promise.all([
    ctx.data.categories(),
    ctx.data.vendors(),
    ctx.data.users(),
  ]);
  return { categories, vendors, users };
}

type Filtered = { rows: Expense[]; labels: string[] } | ToolAsk;

/** Applies the category/vendor/funding/client filters, asking when a name is unclear. */
function applyFilters(
  expenses: Expense[],
  args: Record<string, unknown>,
  tool: string,
  { categories, vendors }: Lookups
): Filtered {
  let rows = expenses;
  const labels: string[] = [];
  if (typeof args.category === "string") {
    const found = resolveRecord(categories, (c) => [c.name], (c) => ({ value: c.name, label: c.name }), args.category, {
      tool,
      args,
      field: "category",
      label: "Category",
    });
    if ("status" in found) return found;
    rows = rows.filter((expense) => expense.category_id === found.item.id);
    labels.push(`category ${found.item.name}`);
  }
  if (typeof args.vendor === "string") {
    const found = resolveRecord(vendors, (v) => [v.name], (v) => ({ value: v.name, label: v.name }), args.vendor, {
      tool,
      args,
      field: "vendor",
      label: "Vendor",
    });
    if ("status" in found) return found;
    rows = rows.filter((expense) => expense.vendor_id === found.item.id);
    labels.push(`vendor ${found.item.name}`);
  }
  if (args.funding === "personal" || args.funding === "company_funds") {
    rows = rows.filter((expense) => expense.funding_source === args.funding);
    labels.push(args.funding === "personal" ? "paid by team members" : "paid from company accounts");
  }
  if (typeof args.client === "string") {
    const wanted = normalizeName(args.client);
    rows = rows.filter((expense) => normalizeName(expense.client).includes(wanted));
    labels.push(`client ${args.client}`);
  }
  return { rows, labels };
}

const GROUP_BY = ["none", "category", "vendor", "month", "funding", "payer", "client"] as const;
type GroupBy = (typeof GROUP_BY)[number];

function groupKeyOf(by: GroupBy, { categories, vendors, users }: Lookups) {
  const category = new Map(categories.map((c) => [c.id, c.name]));
  const vendor = new Map(vendors.map((v) => [v.id, v.name]));
  const user = new Map(users.map((u) => [u.id, u.name]));
  return (expense: Expense): string => {
    switch (by) {
      case "category":
        return category.get(expense.category_id ?? "") ?? "No category";
      case "vendor":
        return vendor.get(expense.vendor_id ?? "") ?? "No vendor";
      case "month":
        return monthKey(expense.expense_date);
      case "funding":
        return expense.funding_source === "company_funds" ? "Company accounts" : "Team-paid";
      case "payer":
        return expense.funding_source === "company_funds"
          ? "Company accounts"
          : user.get(expense.paid_by_user_id ?? "") ?? "Unknown";
      case "client":
        return expense.client?.trim() || "No client";
      default:
        return "All";
    }
  };
}

function groupLabel(by: GroupBy, key: string) {
  return by === "month" ? formatMonth(key) : key;
}

const GROUP_TITLES: Record<GroupBy, string> = {
  none: "",
  category: "By category",
  vendor: "By vendor",
  month: "By month",
  funding: "By who paid",
  payer: "By who paid",
  client: "By client",
};

function groupsTable(by: GroupBy, groups: ExpenseGroup[], total: number): Card {
  const shown = by === "month" ? [...groups].sort((a, b) => a.key.localeCompare(b.key)) : groups.slice(0, 12);
  const rest = by === "month" ? [] : groups.slice(12);
  const rows = shown.map((group) => ({
    name: groupLabel(by, group.key),
    count: String(group.count),
    share: total > 0 ? `${Math.round((group.totalNpr / total) * 100)}%` : "—",
    amount: money(group.totalNpr),
  }));
  if (rest.length) {
    const restTotal = fromPaisa(rest.reduce((sum, group) => sum + toPaisa(group.totalNpr), 0));
    rows.push({
      name: `${rest.length} more`,
      count: String(rest.reduce((sum, group) => sum + group.count, 0)),
      share: total > 0 ? `${Math.round((restTotal / total) * 100)}%` : "—",
      amount: money(restTotal),
    });
  }
  return {
    type: "table",
    title: GROUP_TITLES[by],
    columns: [
      { key: "name", label: by === "month" ? "Month" : "Name" },
      { key: "count", label: "Expenses", align: "right" },
      { key: "share", label: "Share", align: "right" },
      { key: "amount", label: "NPR", align: "right" },
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------

const summarySchema = z.object({
  from: isoDate.optional().describe("First day included, YYYY-MM-DD. Omit with `to` for all time."),
  to: isoDate.optional().describe("Last day included, YYYY-MM-DD."),
  group_by: z.enum(GROUP_BY).optional().describe("Break the total down"),
  ...filters,
  explain,
});

export const getExpenseSummary: ReadTool = {
  name: "get_expense_summary",
  label: "Expense summary",
  kind: "read",
  permission: "member",
  description:
    "Total company spending (NPR) for a period, optionally filtered by category, vendor, who paid or client, and optionally broken down by category, vendor, month, payer or client. Use for 'how much did we spend', 'total expenses', 'spending by category'.",
  schema: summarySchema,
  async run(raw, ctx) {
    const parsed = summarySchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const args = parsed.data;
    const range = dateRange(args.from, args.to);
    if (typeof range === "string") return { status: "error", summary: range };

    const [expenses, refs] = await Promise.all([ctx.data.expenses(), lookups(ctx)]);
    const filtered = applyFilters(expensesInRange(expenses, range), parsed.data, "get_expense_summary", refs);
    if ("status" in filtered) return filtered;

    const totals = expenseTotals(filtered.rows);
    const by = args.group_by ?? "none";
    const groups = by === "none" ? [] : groupExpenses(filtered.rows, groupKeyOf(by, refs));
    const when = rangeText(range.from, range.to);
    const scope = filtered.labels.length ? ` (${filtered.labels.join(", ")})` : "";

    const cards: Card[] = [
      {
        type: "stats",
        items: [
          {
            label: "Total spent",
            value: money(totals.totalNpr),
            hint: `${plural(totals.count, "expense")} · ${when}${scope}`,
          },
          ...(totals.unconvertedCount
            ? [
                {
                  label: "Not in the total",
                  value: plural(totals.unconvertedCount, "expense"),
                  hint: "USD charges still waiting for an exchange rate",
                  tone: "warn" as const,
                },
              ]
            : []),
        ],
      },
    ];
    if (groups.length) cards.push(groupsTable(by, groups, totals.totalNpr));

    let summary = `Avernek spent ${money(totals.totalNpr)} ${when}${scope} across ${plural(totals.count, "expense")}.`;
    if (totals.unconvertedCount) {
      summary += ` ${plural(totals.unconvertedCount, "USD expense")} still need an exchange rate and are not included.`;
    }
    return {
      status: "ok",
      summary,
      cards,
      data: {
        from: range.from ?? null,
        to: range.to ?? null,
        filters: filtered.labels,
        total_npr: totals.totalNpr,
        expenses: totals.count,
        unconverted_expenses: totals.unconvertedCount,
        groups: groups.slice(0, 15).map((group) => ({
          name: groupLabel(by, group.key),
          total_npr: group.totalNpr,
          expenses: group.count,
        })),
      },
    };
  },
};

// ---------------------------------------------------------------------------

const compareSchema = z.object({
  first_from: isoDate.describe("Earlier period, first day"),
  first_to: isoDate.describe("Earlier period, last day"),
  second_from: isoDate.describe("Later period, first day"),
  second_to: isoDate.describe("Later period, last day"),
  group_by: z.enum(["none", "category", "vendor"]).optional().describe("Show which categories or vendors changed most"),
  ...filters,
  explain,
});

export const compareExpenses: ReadTool = {
  name: "compare_expenses",
  label: "Expense comparison",
  kind: "read",
  permission: "member",
  description:
    "Compare spending between two periods (e.g. this month vs last month), with the categories or vendors that changed most. Use for 'did we spend more', 'why did expenses increase'.",
  schema: compareSchema,
  async run(raw, ctx) {
    const parsed = compareSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const args = parsed.data;
    const first = dateRange(args.first_from, args.first_to);
    const second = dateRange(args.second_from, args.second_to);
    if (typeof first === "string") return { status: "error", summary: first };
    if (typeof second === "string") return { status: "error", summary: second };

    const [expenses, refs] = await Promise.all([ctx.data.expenses(), lookups(ctx)]);
    const a = applyFilters(expensesInRange(expenses, first), args, "compare_expenses", refs);
    if ("status" in a) return a;
    const b = applyFilters(expensesInRange(expenses, second), args, "compare_expenses", refs);
    if ("status" in b) return b;

    const totalA = expenseTotals(a.rows);
    const totalB = expenseTotals(b.rows);
    const change = fromPaisa(toPaisa(totalB.totalNpr) - toPaisa(totalA.totalNpr));
    const percent = totalA.totalNpr > 0 ? Math.round((change / totalA.totalNpr) * 1000) / 10 : null;
    const labelA = rangeText(first.from, first.to).replace(/^between /, "");
    const labelB = rangeText(second.from, second.to).replace(/^between /, "");
    const direction = change > 0 ? "more" : change < 0 ? "less" : "the same";

    const cards: Card[] = [
      {
        type: "stats",
        items: [
          { label: labelA, value: money(totalA.totalNpr), hint: plural(totalA.count, "expense") },
          { label: labelB, value: money(totalB.totalNpr), hint: plural(totalB.count, "expense") },
          {
            label: "Change",
            value: `${change > 0 ? "+" : ""}${money(change)}`,
            hint: percent == null ? "no spending in the earlier period" : `${percent > 0 ? "+" : ""}${percent}%`,
            tone: change > 0 ? "warn" : change < 0 ? "good" : "default",
          },
        ],
      },
    ];

    const by = args.group_by ?? "category";
    let movers: { name: string; first: number; second: number; change: number }[] = [];
    if (by !== "none") {
      const keyOf = groupKeyOf(by, refs);
      const groupsA = new Map(groupExpenses(a.rows, keyOf).map((g) => [g.key, g.totalNpr]));
      const groupsB = new Map(groupExpenses(b.rows, keyOf).map((g) => [g.key, g.totalNpr]));
      movers = [...new Set([...groupsA.keys(), ...groupsB.keys()])]
        .map((key) => {
          const before = groupsA.get(key) ?? 0;
          const after = groupsB.get(key) ?? 0;
          return { name: key, first: before, second: after, change: fromPaisa(toPaisa(after) - toPaisa(before)) };
        })
        .filter((row) => row.change !== 0)
        .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
        .slice(0, 10);
      if (movers.length) {
        cards.push({
          type: "table",
          title: by === "vendor" ? "Biggest changes by vendor" : "Biggest changes by category",
          columns: [
            { key: "name", label: "Name" },
            { key: "first", label: "Earlier", align: "right" },
            { key: "second", label: "Later", align: "right" },
            { key: "change", label: "Change", align: "right" },
          ],
          rows: movers.map((row) => ({
            name: row.name,
            first: money(row.first),
            second: money(row.second),
            change: `${row.change > 0 ? "+" : ""}${money(row.change)}`,
          })),
        });
      }
    }

    const summary =
      change === 0
        ? `Spending was the same in both periods: ${money(totalB.totalNpr)}.`
        : `Avernek spent ${money(Math.abs(change))} ${direction} ${labelB} (${money(totalB.totalNpr)}) than ${labelA} (${money(totalA.totalNpr)})${percent == null ? "" : `, ${percent > 0 ? "+" : ""}${percent}%`}.`;
    return {
      status: "ok",
      summary,
      cards,
      data: {
        earlier: { from: first.from, to: first.to, total_npr: totalA.totalNpr, expenses: totalA.count },
        later: { from: second.from, to: second.to, total_npr: totalB.totalNpr, expenses: totalB.count },
        change_npr: change,
        change_percent: percent,
        biggest_changes: movers,
      },
    };
  },
};

// ---------------------------------------------------------------------------

const listSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...filters,
  search: z.string().max(80).optional().describe("Words to find in the note, vendor or client"),
  sort: z.enum(["recent", "largest"]).optional(),
  limit: z.number().int().min(1).max(25).optional().describe("How many to show, default 10"),
});

export const listExpenses: ReadTool = {
  name: "list_expenses",
  label: "Expense list",
  kind: "read",
  permission: "member",
  description:
    "List individual expenses (most recent or largest first), with optional period, category, vendor, payer, client or text filters. Use for 'recent expenses', 'show hosting expenses', 'largest expenses this year'.",
  schema: listSchema,
  async run(raw, ctx) {
    const parsed = listSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const args = parsed.data;
    const range = dateRange(args.from, args.to);
    if (typeof range === "string") return { status: "error", summary: range };

    const [expenses, refs, accounts] = await Promise.all([ctx.data.expenses(), lookups(ctx), ctx.data.moneyAccounts()]);
    const filtered = applyFilters(expensesInRange(expenses, range), args, "list_expenses", refs);
    if ("status" in filtered) return filtered;

    const category = new Map(refs.categories.map((c) => [c.id, c.name]));
    const vendor = new Map(refs.vendors.map((v) => [v.id, v.name]));
    const user = new Map(refs.users.map((u) => [u.id, u.name]));
    const account = new Map(accounts.map((a) => [a.id, a.name]));

    let rows = filtered.rows;
    if (args.search) {
      const words = normalizeName(args.search).split(" ");
      rows = rows.filter((expense) => {
        const text = normalizeName(
          [expense.note, expense.client, vendor.get(expense.vendor_id ?? ""), category.get(expense.category_id ?? "")].join(" ")
        );
        return words.every((word) => text.includes(word));
      });
    }
    if (args.sort === "largest") {
      rows = [...rows].sort((a, b) => toPaisa(b.amount_npr) - toPaisa(a.amount_npr));
    }
    const limit = args.limit ?? 10;
    const shown = rows.slice(0, limit);
    const total = expenseTotals(rows);

    const table: Card = {
      type: "table",
      title: args.sort === "largest" ? "Largest expenses" : "Expenses",
      columns: [
        { key: "date", label: "Date" },
        { key: "what", label: "What" },
        { key: "paid", label: "Paid by" },
        { key: "amount", label: "Amount", align: "right" },
      ],
      rows: shown.map((expense) => ({
        date: formatDate(expense.expense_date),
        what: truncate(
          [vendor.get(expense.vendor_id ?? ""), category.get(expense.category_id ?? ""), expense.note]
            .filter(Boolean)
            .join(" · ") || "—"
        ),
        paid:
          expense.funding_source === "company_funds"
            ? account.get(expense.money_account_id ?? "") ?? "Company account"
            : user.get(expense.paid_by_user_id ?? "") ?? "Team member",
        amount:
          expense.amount_npr != null
            ? `${money(Number(expense.amount_npr))}${expense.currency === "USD" ? ` (${money(Number(expense.amount), "USD")})` : ""}`
            : `${money(Number(expense.amount), expense.currency)} · rate pending`,
      })),
      note: rows.length > shown.length ? `Showing ${shown.length} of ${rows.length}.` : undefined,
    };
    const scope = filtered.labels.length ? ` (${filtered.labels.join(", ")})` : "";
    return {
      status: "ok",
      summary: rows.length
        ? `${plural(rows.length, "expense")} ${rangeText(range.from, range.to)}${scope}, totalling ${money(total.totalNpr)}.`
        : `No expenses ${rangeText(range.from, range.to)}${scope}.`,
      cards: rows.length ? [table] : [{ type: "notice", tone: "info", text: "No matching expenses." }],
      data: {
        matching: rows.length,
        total_npr: total.totalNpr,
        shown: shown.map((expense) => ({
          date: expense.expense_date,
          amount_npr: expense.amount_npr == null ? null : Number(expense.amount_npr),
          vendor: vendor.get(expense.vendor_id ?? "") ?? null,
          category: category.get(expense.category_id ?? "") ?? null,
          note: truncate(expense.note, 80) || null,
        })),
      },
    };
  },
};

// ---------------------------------------------------------------------------

const subscriptionsSchema = z.object({});

export const getSubscriptions: ReadTool = {
  name: "get_subscriptions",
  label: "Subscriptions",
  kind: "read",
  permission: "member",
  description:
    "Active recurring expenses (subscriptions such as hosting, software, phone), their next renewal, and what is expected next month. Use for 'what subscriptions do we pay', 'recurring expenses', 'upcoming renewals'.",
  schema: subscriptionsSchema,
  async run(_raw, ctx) {
    const [subscriptions, rate] = await Promise.all([ctx.data.subscriptions(), ctx.data.usdRate()]);
    // The same window and rate as the dashboard's "Next month" tile.
    const now = new Date();
    const nextMonthStart = format(addMonths(startOfMonth(now), 1), "yyyy-MM-dd");
    const nextMonthEnd = format(addMonths(startOfMonth(now), 2), "yyyy-MM-dd");
    const projected = projectedRenewalsNpr(subscriptions, rate?.rate, nextMonthStart, nextMonthEnd);

    return {
      status: "ok",
      summary: subscriptions.length
        ? `${plural(subscriptions.length, "active subscription")}; about ${money(projected)} is expected to renew next month.`
        : "There are no active subscriptions.",
      cards: [
        {
          type: "stats",
          items: [
            { label: "Expected next month", value: money(projected), hint: "Subscription renewals, as on the dashboard" },
            { label: "Active subscriptions", value: String(subscriptions.length) },
          ],
        },
        ...(subscriptions.length
          ? [
              {
                type: "table" as const,
                title: "Subscriptions",
                columns: [
                  { key: "name", label: "Name" },
                  { key: "cycle", label: "Cycle" },
                  { key: "next", label: "Next renewal" },
                  { key: "amount", label: "Amount", align: "right" as const },
                ],
                rows: subscriptions.map((item) => ({
                  name: item.name,
                  cycle: item.cycle === "monthly" ? "Monthly" : "Annual",
                  next: formatDate(item.next_renewal_date),
                  amount: money(Number(item.amount), item.currency),
                })),
                note: rate ? undefined : "No USD rate yet: USD subscriptions count as zero in the estimate.",
              },
            ]
          : []),
      ],
      data: {
        expected_next_month_npr: projected,
        subscriptions: subscriptions.map((item) => ({
          name: item.name,
          cycle: item.cycle,
          amount: Number(item.amount),
          currency: item.currency,
          next_renewal: item.next_renewal_date,
        })),
      },
    };
  },
};
