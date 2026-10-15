import { z } from "zod";
import {
  AGREEMENT_STATUS_LABELS,
  goLiveDate,
  hasRecurringService,
  servicesLabel,
  type IncomeAgreementSummary,
} from "@/lib/income";
import { fromPaisa, toPaisa } from "@/lib/money";
import type { IncomeAgreement, IncomePayment } from "@/lib/types";
import type { Client } from "../data";
import { addDays, daysBetween, durationLabel, formatDate, formatMonth, isValidDate } from "../dates";
import { money, moneyByCurrency, plural } from "../format";
import { normalizeName } from "../match";
import type { Card } from "../types";
import { clean, dateRange, explain, firstIssue, isoDate, rangeText, resolveClient } from "./common";
import type { ReadTool, ToolAsk, ToolContext } from "./types";

const clientArg = z
  .string()
  .min(1)
  .max(120)
  .describe("Client name as the user said it, e.g. 'Kalika Technical'. Use the conversation's current client for follow-ups.");

/** Adds to a per-currency total, exactly. */
function addTo(totals: Map<string, number>, currency: string, amount: number) {
  totals.set(currency, fromPaisa(toPaisa(totals.get(currency) ?? 0) + toPaisa(amount)));
}

function paymentForLabel(payment: Pick<IncomePayment, "payment_for" | "billing_stream" | "billing_period_start">) {
  if (payment.payment_for === "setup") return "Setup";
  if (payment.payment_for === "website") return "Website";
  const stream =
    payment.billing_stream === "ads" ? "Ads" : payment.billing_stream === "automation" ? "Automation" : "Monthly";
  return `${stream} fee${payment.billing_period_start ? ` · ${formatMonth(payment.billing_period_start)}` : ""}`;
}

/** Bill amount, VAT, TDS and what reached the bank, summed exactly. */
export function taxTotals(rows: Pick<IncomePayment, "amount" | "vat_amount" | "tds_amount">[]) {
  let gross = 0;
  let vat = 0;
  let tds = 0;
  for (const row of rows) {
    gross += toPaisa(row.amount);
    vat += toPaisa(row.vat_amount);
    tds += toPaisa(row.tds_amount);
  }
  return { gross: fromPaisa(gross), vat: fromPaisa(vat), tds: fromPaisa(tds), bank: fromPaisa(gross + vat - tds) };
}

async function clientOrAsk(
  ctx: ToolContext,
  args: Record<string, unknown>,
  tool: string
): Promise<{ client: Client } | ToolAsk> {
  return resolveClient(ctx, String(args.client), tool, args);
}

// ---------------------------------------------------------------------------

const STATUSES = ["active", "pending", "paused", "completed", "cancelled", "all"] as const;

const listSchema = z.object({
  status: z.enum(STATUSES).optional().describe("Which clients; default active"),
  search: z.string().max(80).optional(),
});

export const listClients: ReadTool = {
  name: "list_clients",
  label: "Clients",
  kind: "read",
  permission: "member",
  description:
    "List clients (active by default) with their services, money collected, amount due now and next due date. Use for 'active clients', 'who are our clients', 'paused clients'.",
  schema: listSchema,
  async run(raw, ctx) {
    const parsed = listSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const status = parsed.data.status ?? "active";
    const [agreements, summaries] = await Promise.all([ctx.data.agreements(), ctx.data.summaries()]);
    let rows = status === "all" ? agreements : agreements.filter((agreement) => agreement.status === status);
    if (parsed.data.search) {
      const wanted = normalizeName(parsed.data.search);
      rows = rows.filter((agreement) => normalizeName(agreement.client_name).includes(wanted));
    }
    const dueNow = new Map<string, number>();
    for (const agreement of rows) addTo(dueNow, agreement.currency, summaries.get(agreement.id)!.totalDueNow);
    const label = status === "all" ? "clients" : `${AGREEMENT_STATUS_LABELS[status].toLowerCase()} clients`;

    return {
      status: "ok",
      summary: rows.length
        ? `${plural(rows.length, label.replace(/s$/, ""), label)}; ${moneyByCurrency(dueNow)} is due now from them.`
        : `There are no ${label}.`,
      cards: rows.length
        ? [
            {
              type: "table",
              title: label[0].toUpperCase() + label.slice(1),
              columns: [
                { key: "client", label: "Client" },
                { key: "services", label: "Services" },
                { key: "collected", label: "Collected", align: "right" },
                { key: "due", label: "Due now", align: "right" },
                { key: "next", label: "Next due" },
              ],
              rows: rows.map((agreement) => {
                const summary = summaries.get(agreement.id)!;
                return {
                  client: agreement.client_name,
                  services: servicesLabel(agreement),
                  collected: money(summary.totalCollected, agreement.currency),
                  due: money(summary.totalDueNow, agreement.currency),
                  next: summary.nextDueDate ? formatDate(summary.nextDueDate) : "—",
                };
              }),
            },
          ]
        : [{ type: "notice", tone: "info", text: `No ${label}.` }],
      data: rows.map((agreement) => {
        const summary = summaries.get(agreement.id)!;
        return {
          client: agreement.client_name,
          status: agreement.status,
          services: servicesLabel(agreement),
          currency: agreement.currency,
          collected: summary.totalCollected,
          due_now: summary.totalDueNow,
          overdue: summary.totalOverdue,
        };
      }),
    };
  },
};

// ---------------------------------------------------------------------------

function age(date: string | null | undefined, today: string): string | undefined {
  if (!date || !isValidDate(date)) return undefined;
  const days = daysBetween(date, today);
  return days >= 0 ? `${durationLabel(days)} ago` : durationLabel(days);
}

function timelineCard(agreement: IncomeAgreement, today: string, title: string): Card {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "Services", value: servicesLabel(agreement) || "—" },
    { label: "Status", value: AGREEMENT_STATUS_LABELS[agreement.status] },
    { label: "Contract signed", value: formatDate(agreement.agreement_date), hint: age(agreement.agreement_date, today) },
  ];
  if (isValidDate(agreement.work_start_date)) {
    items.push({ label: "Work started", value: formatDate(agreement.work_start_date), hint: age(agreement.work_start_date, today) });
  }
  if (agreement.has_website) {
    const delivered = agreement.website_completed_date;
    items.push(
      isValidDate(delivered)
        ? {
            label: "Website live (delivered)",
            value: formatDate(delivered),
            hint: `live for ${durationLabel(Math.max(0, daysBetween(delivered, today)))}`,
          }
        : { label: "Website live (delivered)", value: "Not delivered yet" }
    );
  }
  if (hasRecurringService(agreement)) {
    const dayOne = goLiveDate(agreement);
    items.push(
      dayOne
        ? {
            label: "Service live (Day 1)",
            value: formatDate(dayOne),
            hint:
              daysBetween(dayOne, today) >= 0
                ? `live for ${durationLabel(daysBetween(dayOne, today))}`
                : `starts ${durationLabel(daysBetween(dayOne, today))}`,
          }
        : { label: "Service live (Day 1)", value: "Not live yet" }
    );
  }
  if (isValidDate(agreement.contract_end_date)) {
    const days = daysBetween(today, agreement.contract_end_date);
    items.push({
      label: "Contract ends",
      value: formatDate(agreement.contract_end_date),
      hint: days >= 0 ? `in ${durationLabel(days)}` : `ended ${durationLabel(-days)} ago`,
    });
  }
  return { type: "facts", title, items };
}

function moneyCard(agreement: IncomeAgreement, summary: IncomeAgreementSummary, title: string): Card {
  const c = agreement.currency;
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "Collected", value: money(summary.totalCollected, c), hint: "Bill amounts excluding VAT" },
    { label: "Due now", value: money(summary.totalDueNow, c), hint: "As \"Outstanding\" on the Clients page" },
  ];
  if (summary.totalOverdue > 0) items.push({ label: "Overdue", value: money(summary.totalOverdue, c) });
  items.push({ label: "Unpaid balance", value: money(summary.outstanding, c), hint: "Including amounts not due yet" });
  if (summary.setup.agreed > 0) {
    items.push({ label: "Setup charge", value: `${money(summary.setup.paid, c)} of ${money(summary.setup.agreed, c)} paid` });
  }
  if (summary.website) {
    items.push({ label: "Website", value: `${money(summary.website.paid, c)} of ${money(summary.website.agreed, c)} paid` });
  }
  if (summary.recurring.monthlyTotal > 0) {
    items.push({ label: "Monthly fee", value: money(summary.recurring.monthlyTotal, c) });
  }
  if (summary.nextDueDate) {
    items.push({ label: "Next due", value: formatDate(summary.nextDueDate), hint: summary.nextDueLabel ?? undefined });
  }
  if (summary.lastPaymentDate) items.push({ label: "Last payment", value: formatDate(summary.lastPaymentDate) });
  return { type: "facts", title, items };
}

const overviewSchema = z.object({ client: clientArg, explain });

export const getClientOverview: ReadTool = {
  name: "get_client_overview",
  label: "Client overview",
  kind: "read",
  permission: "member",
  description:
    "Everything about one client: services, status, contract and launch dates with how many days ago (contract age, website live since delivery, service live since Day 1), and money: collected, due now, overdue, unpaid balance, monthly fee, next due, last payment. Use for 'how much has X paid', 'how much is remaining', 'how long has their website been live', 'when did their contract start'.",
  schema: overviewSchema,
  async run(raw, ctx) {
    const parsed = overviewSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const found = await clientOrAsk(ctx, parsed.data, "get_client_overview");
    if ("status" in found) return found;
    const { client } = found;
    const summaries = await ctx.data.summaries();

    const agreements = [...client.agreements].sort(
      (a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || b.agreement_date.localeCompare(a.agreement_date)
    );
    const shown = agreements.slice(0, 3);
    const cards: Card[] = [];
    for (const agreement of shown) {
      const name = agreements.length > 1 ? `${client.name} · ${agreement.agreement_name || servicesLabel(agreement)}` : client.name;
      cards.push(timelineCard(agreement, ctx.today, name));
      cards.push(moneyCard(agreement, summaries.get(agreement.id)!, `${name} · payments`));
    }
    if (agreements.length > shown.length) {
      cards.push({ type: "notice", tone: "info", text: `${agreements.length - shown.length} older agreements are not shown.` });
    }

    const collected = new Map<string, number>();
    const dueNow = new Map<string, number>();
    const unpaid = new Map<string, number>();
    for (const agreement of agreements) {
      const summary = summaries.get(agreement.id)!;
      addTo(collected, agreement.currency, summary.totalCollected);
      addTo(dueNow, agreement.currency, summary.totalDueNow);
      addTo(unpaid, agreement.currency, summary.outstanding);
    }
    const first = shown[0];
    const websiteLine =
      first?.has_website && isValidDate(first.website_completed_date)
        ? ` The website has been live since ${formatDate(first.website_completed_date)} (${durationLabel(daysBetween(first.website_completed_date!, ctx.today))}).`
        : "";
    return {
      status: "ok",
      summary: `${client.name} has paid ${moneyByCurrency(collected)}. ${moneyByCurrency(dueNow)} is due now, and the unpaid balance is ${moneyByCurrency(unpaid)}.${websiteLine}`,
      cards,
      context: { client: client.name },
      data: agreements.map((agreement) => {
        const summary = summaries.get(agreement.id)!;
        return {
          client: agreement.client_name,
          agreement: agreement.agreement_name,
          status: agreement.status,
          services: servicesLabel(agreement),
          currency: agreement.currency,
          contract_signed: agreement.agreement_date,
          work_started: agreement.work_start_date,
          website_delivered: agreement.website_completed_date,
          service_day_one: goLiveDate(agreement),
          contract_end: agreement.contract_end_date,
          collected: summary.totalCollected,
          due_now: summary.totalDueNow,
          overdue: summary.totalOverdue,
          unpaid_balance: summary.outstanding,
          monthly_fee: summary.recurring.monthlyTotal,
          next_due: summary.nextDueDate,
          last_payment: summary.lastPaymentDate,
          today: ctx.today,
        };
      }),
    };
  },
};

// ---------------------------------------------------------------------------

const paymentsSchema = z.object({
  client: clientArg.optional().describe("Omit for every client's payments"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  payment_for: z.enum(["setup", "website", "recurring"]).optional(),
});

export const getClientPayments: ReadTool = {
  name: "get_client_payments",
  label: "Client payments",
  kind: "read",
  permission: "member",
  description:
    "Payments received from one client (or all clients) in a period, each with bill amount, VAT, TDS and what reached the bank. Use for 'payment history', 'when did X last pay', 'payments received in October'.",
  schema: paymentsSchema,
  async run(raw, ctx) {
    const parsed = paymentsSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const args = parsed.data;
    const range = dateRange(args.from, args.to);
    if (typeof range === "string") return { status: "error", summary: range };

    const [agreements, payments] = await Promise.all([ctx.data.agreements(), ctx.data.payments()]);
    let ids: Set<string> | null = null;
    let clientName: string | null = null;
    if (args.client) {
      const found = await clientOrAsk(ctx, args, "get_client_payments");
      if ("status" in found) return found;
      ids = new Set(found.client.agreements.map((agreement) => agreement.id));
      clientName = found.client.name;
    }
    const byId = new Map(agreements.map((agreement) => [agreement.id, agreement]));
    const rows = payments.filter(
      (payment) =>
        (!ids || ids.has(payment.agreement_id)) &&
        (!range.from || payment.paid_on >= range.from) &&
        (!range.before || payment.paid_on < range.before) &&
        (!args.payment_for || payment.payment_for === args.payment_for)
    );

    const byCurrency = new Map<string, IncomePayment[]>();
    for (const payment of rows) {
      const currency = byId.get(payment.agreement_id)?.currency ?? "NPR";
      byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), payment]);
    }
    const totals = [...byCurrency.entries()].map(([currency, list]) => ({ currency, ...taxTotals(list) }));
    const who = clientName ?? "all clients";
    const when = rangeText(range.from, range.to);

    const cards: Card[] = rows.length
      ? [
          {
            type: "stats",
            items: totals.map((total) => ({
              label: `Received${totals.length > 1 ? ` (${total.currency})` : ""}`,
              value: money(total.gross, total.currency),
              hint: `${plural(byCurrency.get(total.currency)!.length, "payment")} · excl. VAT · ${money(total.bank, total.currency)} reached the bank`,
            })),
          },
          {
            type: "table",
            title: `Payments · ${who}`,
            columns: [
              { key: "date", label: "Date" },
              ...(clientName ? [] : [{ key: "client", label: "Client" }]),
              { key: "for", label: "For" },
              { key: "amount", label: "Amount", align: "right" as const },
              { key: "vat", label: "VAT", align: "right" as const },
              { key: "tds", label: "TDS", align: "right" as const },
              { key: "bank", label: "Bank", align: "right" as const },
            ],
            rows: rows.slice(0, 25).map((payment) => {
              const currency = byId.get(payment.agreement_id)?.currency ?? "NPR";
              const t = taxTotals([payment]);
              return {
                date: formatDate(payment.paid_on),
                client: byId.get(payment.agreement_id)?.client_name ?? "—",
                for: paymentForLabel(payment),
                amount: money(t.gross, currency),
                vat: t.vat ? money(t.vat, currency) : "—",
                tds: t.tds ? money(t.tds, currency) : "—",
                bank: money(t.bank, currency),
              };
            }),
            note: rows.length > 25 ? `Showing 25 of ${rows.length} payments.` : undefined,
          },
        ]
      : [{ type: "notice", tone: "info", text: `No payments from ${who} ${when}.` }];

    return {
      status: "ok",
      summary: rows.length
        ? `${plural(rows.length, "payment")} from ${who} ${when}: ${totals.map((t) => money(t.gross, t.currency)).join(" and ")} excluding VAT.`
        : `No payments from ${who} ${when}.`,
      cards,
      context: clientName ? { client: clientName } : undefined,
      data: {
        client: clientName,
        from: range.from ?? null,
        to: range.to ?? null,
        totals,
        payments: rows.slice(0, 25).map((payment) => ({
          paid_on: payment.paid_on,
          client: byId.get(payment.agreement_id)?.client_name,
          for: paymentForLabel(payment),
          ...taxTotals([payment]),
        })),
      },
    };
  },
};

// ---------------------------------------------------------------------------

const receivablesSchema = z.object({
  scope: z
    .enum(["due_now", "overdue", "unpaid_balance"])
    .optional()
    .describe("due_now (default, as 'Outstanding' on the Clients page), overdue, or unpaid_balance (everything unpaid, incl. not yet due)"),
});

const SCOPE_LABELS = { due_now: "due now", overdue: "overdue", unpaid_balance: "unpaid" } as const;

export const getReceivables: ReadTool = {
  name: "get_receivables",
  label: "Money owed by clients",
  kind: "read",
  permission: "member",
  description:
    "Which clients owe money and how much: due now (default), overdue, or the whole unpaid balance; with totals. Use for 'total outstanding payments', 'unpaid clients', 'who owes us', 'overdue clients'.",
  schema: receivablesSchema,
  async run(raw, ctx) {
    const parsed = receivablesSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const scope = parsed.data.scope ?? "due_now";
    const [agreements, summaries] = await Promise.all([ctx.data.agreements(), ctx.data.summaries()]);
    const valueOf = (summary: IncomeAgreementSummary) =>
      scope === "due_now" ? summary.totalDueNow : scope === "overdue" ? summary.totalOverdue : summary.outstanding;

    const rows = agreements
      .map((agreement) => ({ agreement, summary: summaries.get(agreement.id)!, value: valueOf(summaries.get(agreement.id)!) }))
      .filter((row) => row.value > 0.004)
      .sort((a, b) => b.value - a.value);
    const totals = new Map<string, number>();
    for (const row of rows) addTo(totals, row.agreement.currency, row.value);
    const label = SCOPE_LABELS[scope];

    return {
      status: "ok",
      summary: rows.length
        ? `${moneyByCurrency(totals)} is ${label} from ${plural(new Set(rows.map((r) => r.agreement.client_name)).size, "client")}.`
        : `No client has anything ${label}.`,
      cards: rows.length
        ? [
            {
              type: "stats",
              items: [...totals.entries()].map(([currency, amount]) => ({
                label: `Total ${label}${totals.size > 1 ? ` (${currency})` : ""}`,
                value: money(amount, currency),
                hint: scope === "due_now" ? "Matches \"Outstanding\" on the Clients page" : undefined,
                tone: scope === "overdue" ? ("bad" as const) : ("warn" as const),
              })),
            },
            {
              type: "table",
              title: `Clients with money ${label}`,
              columns: [
                { key: "client", label: "Client" },
                { key: "status", label: "Status" },
                { key: "amount", label: label[0].toUpperCase() + label.slice(1), align: "right" },
                { key: "next", label: "Next due" },
                { key: "last", label: "Last paid" },
              ],
              rows: rows.map(({ agreement, summary, value }) => ({
                client: agreement.client_name,
                status: AGREEMENT_STATUS_LABELS[agreement.status],
                amount: money(value, agreement.currency),
                next: summary.nextDueDate ? formatDate(summary.nextDueDate) : "—",
                last: summary.lastPaymentDate ? formatDate(summary.lastPaymentDate) : "never",
              })),
            },
          ]
        : [{ type: "notice", tone: "info", text: `Nothing is ${label}.` }],
      data: {
        scope,
        totals: Object.fromEntries(totals),
        clients: rows.map(({ agreement, summary, value }) => ({
          client: agreement.client_name,
          currency: agreement.currency,
          amount: value,
          overdue: summary.totalOverdue,
          next_due: summary.nextDueDate,
          last_payment: summary.lastPaymentDate,
        })),
      },
    };
  },
};

// ---------------------------------------------------------------------------

const upcomingSchema = z.object({
  within_days: z.number().int().min(1).max(120).optional().describe("Look this many days ahead; default 14"),
});

export const getUpcomingPayments: ReadTool = {
  name: "get_upcoming_payments",
  label: "Upcoming client payments",
  kind: "read",
  permission: "member",
  description:
    "Client payments falling due in the next days (setup charges, website payments and monthly fees not yet paid). Use for 'upcoming payments', 'who pays this week', 'what is due soon'.",
  schema: upcomingSchema,
  async run(raw, ctx) {
    const parsed = upcomingSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const days = parsed.data.within_days ?? 14;
    const until = addDays(ctx.today, days);
    const [agreements, summaries] = await Promise.all([ctx.data.agreements(), ctx.data.summaries()]);

    type Item = { client: string; what: string; due: string; amount: number; currency: string };
    const items: Item[] = [];
    const inWindow = (date: string | null | undefined): date is string =>
      Boolean(date) && date! >= ctx.today && date! <= until;
    for (const agreement of agreements) {
      if (agreement.status === "cancelled" || agreement.status === "completed") continue;
      const summary = summaries.get(agreement.id)!;
      const push = (what: string, due: string, amount: number) =>
        items.push({ client: agreement.client_name, what, due, amount, currency: agreement.currency });
      if (summary.setup.remaining > 0 && inWindow(summary.setup.dueDate)) push("Setup", summary.setup.dueDate, summary.setup.remaining);
      if (summary.website && summary.website.remaining > 0 && inWindow(summary.website.dueDate)) {
        push("Website", summary.website.dueDate, summary.website.remaining);
      }
      for (const stream of summary.recurring.streams) {
        for (const period of stream.periods) {
          if (period.remaining > 0 && inWindow(period.dueDate)) {
            push(`${stream.label} · ${formatMonth(period.periodStart)}`, period.dueDate, period.remaining);
          }
        }
      }
    }
    items.sort((a, b) => a.due.localeCompare(b.due) || b.amount - a.amount);
    const totals = new Map<string, number>();
    for (const item of items) addTo(totals, item.currency, item.amount);

    return {
      status: "ok",
      summary: items.length
        ? `${plural(items.length, "payment")} totalling ${moneyByCurrency(totals)} fall due in the next ${days} days.`
        : `No client payments fall due in the next ${days} days.`,
      cards: items.length
        ? [
            {
              type: "table",
              title: `Due by ${formatDate(until)}`,
              columns: [
                { key: "due", label: "Due" },
                { key: "client", label: "Client" },
                { key: "what", label: "For" },
                { key: "amount", label: "Amount", align: "right" },
              ],
              rows: items.map((item) => ({
                due: formatDate(item.due),
                client: item.client,
                what: item.what,
                amount: money(item.amount, item.currency),
              })),
              note: "Amounts exclude VAT. Already overdue items are under \"money owed\".",
            },
          ]
        : [{ type: "notice", tone: "info", text: `Nothing falls due by ${formatDate(until)}.` }],
      data: { until, totals: Object.fromEntries(totals), items },
    };
  },
};
