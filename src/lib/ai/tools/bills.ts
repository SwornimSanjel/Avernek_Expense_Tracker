import { z } from "zod";
import { formatNumber } from "@/lib/format";
import { claimedVat } from "@/lib/funds";
import { monthLabel } from "@/lib/dates";
import { money, plural, truncate } from "../format";
import { normalizeName } from "../match";
import type { Card } from "../types";
import { clean, dateRange, firstIssue, isoDate, rangeText } from "./common";
import type { ReadTool } from "./types";

/**
 * Bills in Avernek's name (the Bills page), month by month as the page shows
 * them: each month's bills newest first, with the month's total and VAT, and
 * what is still to be paid back from the VAT account.
 */

/** Most rows shown across all months; the totals always cover every bill. */
const MAX_ROWS = 40;

/** "30 Aug": the table's title already names the month and year. */
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const listBillsSchema = z.object({
  from: isoDate.optional().describe("First bill date included"),
  to: isoDate.optional().describe("Last bill date included"),
  search: z.string().max(80).optional().describe("Words to find in the vendor, what it was for, bill no. or note"),
  only_unpaid: z.boolean().optional().describe("true for bills marked to be paid back that are not fully paid back yet"),
});

export const listCompanyBills: ReadTool = {
  name: "list_company_bills",
  label: "Bills in Avernek's name",
  kind: "read",
  permission: "member",
  description:
    "List bills issued in Avernek's name (the Bills page: VAT/PAN bills from cafes, shops, lawyers), grouped by month, newest first, with each month's total and VAT, and what is still to pay back for bills being paid back. Optional period, text and unpaid filters. Use for 'show our VAT bills', 'bills in August', 'bills from Himalayan SIP', 'which bills are still to be reimbursed'.",
  schema: listBillsSchema,
  async run(raw, ctx) {
    const parsed = listBillsSchema.safeParse(clean(raw));
    if (!parsed.success) return { status: "error", summary: firstIssue(parsed.error) };
    const args = parsed.data;
    const range = dateRange(args.from, args.to);
    if (typeof range === "string") return { status: "error", summary: range };

    const { billStatuses } = await ctx.data.ledger();
    const words = args.search ? normalizeName(args.search).split(" ").filter(Boolean) : [];
    const items = billStatuses
      .filter(({ bill }) => (!range.from || bill.bill_date >= range.from) && (!range.to || bill.bill_date <= range.to))
      .filter((item) => !args.only_unpaid || item.pending > 0)
      .filter(({ bill }) => {
        if (!words.length) return true;
        const text = normalizeName([bill.vendor_name, bill.description, bill.bill_number, bill.note].join(" "));
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => b.bill.bill_date.localeCompare(a.bill.bill_date));

    const scope = [args.search ? `matching "${args.search}"` : "", args.only_unpaid ? "not yet reimbursed" : ""].filter(Boolean).join(", ");
    const when = `${rangeText(range.from, range.to)}${scope ? ` (${scope})` : ""}`;
    if (!items.length) {
      return { status: "ok", summary: `No bills in Avernek's name ${when}.`, cards: [{ type: "notice", tone: "info", text: "No matching bills." }], data: { count: 0 } };
    }

    const sum = (list: typeof items, pick: (item: (typeof items)[number]) => number) => list.reduce((total, item) => total + pick(item), 0);
    const totalOf = (list: typeof items) => sum(list, (item) => Number(item.bill.total_amount));
    const vatOf = (list: typeof items) => sum(list, (item) => Number(item.bill.vat_amount));
    const claimedOf = (list: typeof items) => sum(list, (item) => claimedVat(item.bill));
    const pending = sum(items, (item) => item.pending);

    const months = [...new Set(items.map((item) => item.bill.bill_date.slice(0, 7)))];
    const cards: Card[] = [
      {
        type: "stats",
        items: [
          { label: "Bills", value: String(items.length), hint: `${plural(months.length, "month")}` },
          { label: "Total", value: money(totalOf(items)), hint: "VAT included" },
          { label: "VAT inside", value: money(vatOf(items)), hint: "Paid on these bills", tone: "warn" },
          { label: "VAT claimed", value: money(claimedOf(items)), hint: "Lowers the VAT owed to IRD", tone: "good" },
          ...(pending > 0 ? [{ label: "Still to reimburse", value: money(pending), tone: "warn" as const }] : []),
        ],
      },
    ];
    let shown = 0;
    for (const key of months) {
      if (shown >= MAX_ROWS) break;
      const rows = items.filter((item) => item.bill.bill_date.startsWith(key));
      const visible = rows.slice(0, MAX_ROWS - shown);
      shown += visible.length;
      cards.push({
        type: "table",
        title: `${monthLabel(key)} · ${plural(rows.length, "bill")}`,
        columns: [
          { key: "date", label: "Date" },
          { key: "bill", label: "Bill" },
          { key: "total", label: "Total", align: "right" },
          { key: "vat", label: "VAT", align: "right" },
        ],
        rows: visible.map(({ bill, pending: left, reimbursed }) => ({
          date: dayMonth.format(new Date(`${bill.bill_date}T00:00:00Z`)),
          // The bill number stays whole: it is what tells two bills from one shop apart.
          bill: `${truncate(bill.vendor_name ?? bill.description, 30)}${bill.bill_number ? ` #${bill.bill_number}` : ""}${left > 0 ? " · to pay back" : reimbursed > 0 ? " · paid back" : ""}`,
          total: formatNumber(Number(bill.total_amount)),
          vat:
            Number(bill.vat_amount) > 0
              ? `${formatNumber(Number(bill.vat_amount))}${claimedVat(bill) > 0 ? " claimed" : ""}`
              : "—",
        })),
        footer: { date: "Total", bill: "", total: formatNumber(totalOf(rows)), vat: formatNumber(vatOf(rows)) },
        note: visible.length < rows.length ? `Showing ${visible.length} of ${rows.length}.` : undefined,
      });
    }
    if (shown < items.length) {
      cards.push({ type: "notice", tone: "info", text: `Showing ${shown} of ${items.length} bills. Ask for a shorter period to see the rest.` });
    }

    return {
      status: "ok",
      summary: `${plural(items.length, "bill")} ${when}: ${money(totalOf(items))} with VAT ${formatNumber(vatOf(items))}, of which ${formatNumber(claimedOf(items))} claimed${pending > 0 ? `; ${money(pending)} still to reimburse` : ""}.`,
      cards,
      data: {
        count: items.length,
        total_npr: totalOf(items),
        vat_npr: vatOf(items),
        vat_claimed_npr: claimedOf(items),
        to_reimburse_npr: pending,
        months: months.map((key) => {
          const rows = items.filter((item) => item.bill.bill_date.startsWith(key));
          return { month: key, bills: rows.length, total_npr: totalOf(rows), vat_npr: vatOf(rows) };
        }),
      },
    };
  },
};
