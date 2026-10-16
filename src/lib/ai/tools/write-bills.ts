import { z } from "zod";
import { addCompanyBills, type CompanyBillInput } from "@/app/(app)/funds/actions";
import { formatNumber } from "@/lib/format";
import { vatInsideTotal } from "@/lib/tax";
import { formatDate, isValidDate } from "../dates";
import { money } from "../format";
import { normalizeName } from "../match";
import type { FieldSpec } from "../types";
import { clean, isoDate } from "./common";
import type { ToolAsk, ToolContext, ToolReady, WriteTool } from "./types";

/**
 * Bills in Avernek's name (the Bills page), added in a batch: "add these bills"
 * with a pasted list. The rules are the Add VAT bill form's: what it was for,
 * the total (VAT included) and the date are required; a VAT bill's VAT is
 * worked out at 13% unless the bill's printed VAT is given; a PAN bill has none.
 * That VAT is what was paid; it is claimed from IRD only when the user says so
 * (VAT on food and drinks usually cannot be claimed).
 *
 * Every bill is shown on one confirmation. A bill with no date is dated today,
 * as on the form, and the confirmation says so. A bill missing anything else
 * is listed there but not saved, and "Change something" fixes or drops any
 * bill: the whole list travels with the form, so nothing is retyped.
 */

export const MAX_BILLS = 20;

const billSchema = z.object({
  description: z.string().max(200).optional().describe("What the bill was for, e.g. 'Team lunch' or 'Company incorporation'"),
  vendor: z.string().max(120).optional().describe("The shop or company that issued the bill"),
  bill_no: z.string().max(60).optional().describe("Bill or invoice number printed on it"),
  total: z.number().positive().optional().describe("Bill total in NPR, VAT included"),
  bill_date: isoDate
    .optional()
    .describe("YYYY-MM-DD in AD. In Nepal dates are written DD/MM/YYYY. Omit when only a Nepali (BS) date or no date was given: the bill is then dated today"),
  vat_bill: z
    .boolean()
    .optional()
    .describe("false for a PAN bill, 'no VAT' or 'untick VAT'; true for a VAT / tax invoice; omit if not said"),
  vat_amount: z.number().min(0).optional().describe("The VAT printed on the bill, only when the user gave it"),
  paid_by: z.string().max(120).optional().describe("Who paid it first, as the user said it"),
  note: z.string().max(300).optional(),
  reimburse: z
    .boolean()
    .optional()
    .describe("true only when the user says the VAT account should pay this bill back to whoever paid it; omit otherwise"),
  claim_vat: z
    .boolean()
    .optional()
    .describe("true only when the user says this bill's VAT can be claimed/deducted from the VAT owed to IRD; false or omit when they say it cannot (e.g. food and drinks)"),
});

const schema = z.object({
  bills: z.array(billSchema).min(1).max(MAX_BILLS).describe("Every bill the user listed, in their order"),
});

/** One bill as it travels between the model, the forms and the draft: flat and JSON-safe. */
type Bill = {
  description: string | null;
  vendor: string | null;
  bill_no: string | null;
  total: number | null;
  bill_date: string | null;
  vat_bill: boolean;
  /** The printed VAT; null means "work it out at 13%". */
  vat_amount: number | null;
  paid_by: string | null;
  note: string | null;
  /** No date was given, so the app dated it today. */
  dated_today: boolean;
  /** The VAT account is to pay it back; off unless the user asked. */
  reimburse: boolean;
  /** Its VAT is claimed from IRD; off unless the user said it can be. */
  claim_vat: boolean;
};

/** `vat` is the VAT on the bill (paid); `claimed` the part claimed from IRD. */
type Checked = { bill: Bill; vat: number; claimed: number; errors: Record<string, string> };

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function amount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function toBill(raw: unknown): Bill {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const vatAmount = amount(v.vat_amount);
  return {
    description: text(v.description, 200),
    vendor: text(v.vendor, 120),
    bill_no: text(v.bill_no, 60),
    total: amount(v.total),
    bill_date: text(v.bill_date, 10),
    // As on the form: a bill is a VAT bill unless it is said not to be.
    vat_bill: v.vat_bill === false || v.vat_bill === "false" ? false : true,
    vat_amount: vatAmount,
    paid_by: text(v.paid_by, 120),
    note: text(v.note, 300),
    dated_today: v.dated_today === true,
    reimburse: v.reimburse === true || v.reimburse === "true",
    claim_vat: v.claim_vat === true || v.claim_vat === "true",
  };
}

function check(bill: Bill, today: string): Checked {
  const errors: Record<string, string> = {};
  if (!bill.description) errors.description = "Say what the bill was for.";
  if (bill.total == null || bill.total <= 0) errors.total = "Enter the bill total.";
  if (!bill.bill_date) errors.bill_date = "Enter the bill date (in AD).";
  else if (!isValidDate(bill.bill_date)) errors.bill_date = "Not a real date.";
  else if (bill.bill_date > today) errors.bill_date = "This date is after today. Check it.";
  const vat = !bill.vat_bill || bill.total == null ? 0 : (bill.vat_amount ?? vatInsideTotal(bill.total));
  if (bill.vat_bill && bill.total != null && (vat < 0 || vat > bill.total)) errors.vat_amount = "VAT must be between zero and the bill total.";
  return { bill, vat, claimed: bill.claim_vat ? vat : 0, errors };
}

const FIELD_NAMES: Record<string, string> = {
  description: "what it was for",
  total: "the total",
  bill_date: "the date",
  vat_amount: "the VAT",
};

function missing(errors: Record<string, string>): string {
  return Object.keys(errors)
    .map((key) => FIELD_NAMES[key] ?? key)
    .join(", ");
}

function label(bill: Bill, index: number): string {
  const name = bill.vendor ?? bill.description ?? "Bill";
  return `${index + 1} · ${name}${bill.bill_no ? ` #${bill.bill_no}` : ""}`;
}

function vatText(item: Checked): string {
  if (!item.bill.vat_bill) return "no VAT";
  const worked = item.bill.vat_amount == null ? " (13%)" : "";
  return `VAT ${formatNumber(item.vat)}${worked} ${item.claimed > 0 ? "claimed" : "not claimed"}`;
}

/** Bills that look like ones already added, or repeated in the list. */
function duplicates(items: Checked[], existing: ExistingBill[]): string[] {
  const warnings: string[] = [];
  const sameNumber = (a: { vendor: string | null; no: string | null }, b: { vendor: string | null; no: string | null }) =>
    Boolean(a.no && b.no && normalizeName(a.no) === normalizeName(b.no)) &&
    (!a.vendor || !b.vendor || normalizeName(a.vendor) === normalizeName(b.vendor));
  items.forEach((item, index) => {
    const { bill } = item;
    if (bill.total == null) return;
    const mine = { vendor: bill.vendor, no: bill.bill_no };
    const saved = existing.find(
      (row) =>
        sameNumber(mine, { vendor: row.vendor_name, no: row.bill_number }) ||
        (row.bill_date === bill.bill_date && Math.abs(Number(row.total_amount) - bill.total!) < 0.01)
    );
    if (saved) {
      warnings.push(
        `Bill ${label(bill, index)} looks already added: ${saved.vendor_name ?? saved.description}, ${formatDate(saved.bill_date)}, ${money(Number(saved.total_amount))}.`
      );
      return;
    }
    const earlier = items.findIndex(
      (other, otherIndex) =>
        otherIndex < index &&
        (sameNumber(mine, { vendor: other.bill.vendor, no: other.bill.bill_no }) ||
          (other.bill.bill_date === bill.bill_date && other.bill.total === bill.total && normalizeName(other.bill.vendor) === normalizeName(bill.vendor)))
    );
    if (earlier >= 0) warnings.push(`Bills ${earlier + 1} and ${index + 1} look like the same bill.`);
  });
  return warnings;
}

/** A printed VAT far from 13% of the total is usually a typo. */
function vatWarnings(items: Checked[]): string[] {
  return items.flatMap((item, index) => {
    const { bill } = item;
    if (!bill.vat_bill || bill.vat_amount == null || bill.total == null) return [];
    const expected = vatInsideTotal(bill.total);
    if (Math.abs(bill.vat_amount - expected) <= Math.max(1, expected * 0.02)) return [];
    return [`Bill ${index + 1}: VAT ${formatNumber(bill.vat_amount)} is not 13% of ${money(bill.total)} (that would be ${formatNumber(expected)}). Check it.`];
  });
}

type ExistingBill = {
  description: string;
  vendor_name: string | null;
  bill_number: string | null;
  bill_date: string;
  total_amount: number | string;
};

function pickForm(bills: Bill[]): ToolAsk {
  return {
    status: "needs_input",
    summary: "Which bill do you want to change?",
    form: {
      tool: addCompanyBillsTool.name,
      title: "Change a bill",
      values: { bills, _stage: "pick" },
      fields: [
        {
          name: "edit_index",
          label: "Bill",
          type: "select",
          required: true,
          options: bills.map((bill, index) => ({
            value: String(index),
            label: `${label(bill, index)}${bill.total != null ? ` · ${money(bill.total)}` : ""}`,
          })),
        },
        {
          name: "edit_action",
          label: "What to do",
          type: "choice",
          required: true,
          value: "change",
          options: [
            { value: "change", label: "Change its details" },
            { value: "remove", label: "Leave it out", hint: "It will not be saved" },
          ],
        },
      ],
      submitLabel: "Next",
    },
  };
}

function billForm(bills: Bill[], index: number, errors: Record<string, string>, message?: string): ToolAsk {
  const bill = bills[index];
  const s = (value: string | number | null) => (value == null ? "" : String(value));
  const fields: FieldSpec[] = [
    { name: "f_description", label: "What is the bill for?", type: "text", required: true, value: s(bill.description), placeholder: "e.g. Team lunch", error: errors.description },
    { name: "f_vendor", label: "Vendor", type: "text", required: false, value: s(bill.vendor) },
    { name: "f_bill_no", label: "Bill no.", type: "text", required: false, value: s(bill.bill_no) },
    { name: "f_total", label: "Bill total (incl. VAT)", type: "number", required: true, min: 0.01, step: 0.01, value: s(bill.total), error: errors.total },
    { name: "f_bill_date", label: "Bill date", type: "date", required: true, value: s(bill.bill_date), error: errors.bill_date },
    {
      name: "f_vat",
      label: "VAT",
      type: "choice",
      required: true,
      value: bill.vat_bill ? "yes" : "no",
      options: [
        { value: "yes", label: "VAT bill", hint: "13% VAT included in the total" },
        { value: "no", label: "No VAT", hint: "A PAN bill" },
      ],
    },
    {
      name: "f_vat_amount",
      label: "VAT inside the bill",
      type: "number",
      required: false,
      min: 0,
      step: 0.01,
      value: s(bill.vat_amount),
      help: "Leave empty to work it out at 13%.",
      error: errors.vat_amount,
    },
    {
      name: "f_claim",
      label: "Claim this VAT from IRD?",
      type: "choice",
      required: true,
      value: bill.claim_vat ? "yes" : "no",
      options: [
        { value: "no", label: "No", hint: "Paid, but not claimable (food, drinks)" },
        { value: "yes", label: "Yes", hint: "Lowers the VAT Avernek owes" },
      ],
    },
    { name: "f_paid_by", label: "Who paid it first?", type: "text", required: false, value: s(bill.paid_by), placeholder: "e.g. Swornim · non-VAT account" },
    {
      name: "f_reimburse",
      label: "Pay it back from the VAT account?",
      type: "choice",
      required: true,
      value: bill.reimburse ? "yes" : "no",
      options: [
        { value: "no", label: "No", hint: "Kept for the books and VAT only" },
        { value: "yes", label: "Yes", hint: "Whoever paid gets it back" },
      ],
    },
    { name: "f_note", label: "Note", type: "text", required: false, value: s(bill.note) },
  ];
  return {
    status: "needs_input",
    summary: message ?? `Bill ${index + 1} of ${bills.length}: change what you need.`,
    form: {
      tool: addCompanyBillsTool.name,
      title: `Bill ${index + 1} of ${bills.length}`,
      message: Object.keys(errors).length ? `Needs ${missing(errors)}.` : undefined,
      values: { bills, _stage: "bill", edit_index: String(index) },
      fields,
      submitLabel: "Next",
    },
  };
}

/** The bill form's answers, put back into the list. An emptied field clears it. */
function fromForm(values: Record<string, unknown>, before: Bill): Bill {
  return toBill({
    description: values.f_description,
    vendor: values.f_vendor,
    bill_no: values.f_bill_no,
    total: values.f_total,
    bill_date: values.f_bill_date,
    vat_bill: values.f_vat === "no" ? false : values.f_vat === "yes" ? true : before.vat_bill,
    vat_amount: values.f_vat_amount,
    paid_by: values.f_paid_by,
    note: values.f_note,
    reimburse: values.f_reimburse === "yes" ? true : values.f_reimburse === "no" ? false : before.reimburse,
    claim_vat: values.f_claim === "yes" ? true : values.f_claim === "no" ? false : before.claim_vat,
  });
}

function toInput(item: Checked): CompanyBillInput {
  const { bill } = item;
  return {
    description: bill.description!,
    vendor_name: bill.vendor,
    bill_number: bill.bill_no,
    bill_date: bill.bill_date!,
    total_amount: bill.total!,
    vat_amount: item.vat,
    paid_by: bill.paid_by,
    note: bill.note,
    reimburse: bill.reimburse,
    claim_vat: item.claimed > 0,
  };
}

function indexOf(value: unknown, length: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n < length ? n : null;
}

async function existingBills(ctx: ToolContext): Promise<ExistingBill[]> {
  return ctx.data.companyBills();
}

export const addCompanyBillsTool: WriteTool = {
  name: "add_company_bills",
  label: "Add bills",
  kind: "write",
  permission: "admin",
  description:
    "Prepare bills issued in Avernek's name (VAT/tax invoices or PAN bills from shops, cafes, lawyers) for the Bills page. Put EVERY bill the user listed in one call, in their order. Pass only details the user gave; the app asks for anything missing and always shows a confirmation before saving. Never claim they are saved.",
  schema,
  async run(raw, ctx) {
    const v = clean(raw);
    let bills = Array.isArray(v.bills) ? v.bills.slice(0, MAX_BILLS + 1).map(toBill) : [];
    if (!bills.length) {
      return { status: "error", summary: "Tell me the bills to add: what each one was for, its total and its date." };
    }
    if (bills.length > MAX_BILLS) return { status: "error", summary: `I can add at most ${MAX_BILLS} bills at a time. Send the rest in a second message.` };

    // "Change something" on the confirmation: pick a bill, then change or drop it.
    if (v._edit === true) return pickForm(bills);
    const index = indexOf(v.edit_index, bills.length);
    if (v._stage === "pick" && index != null) {
      if (v.edit_action === "remove") {
        bills = bills.filter((_, position) => position !== index);
        if (!bills.length) return { status: "error", summary: "Every bill was left out, so there is nothing to add." };
      } else {
        return billForm(bills, index, check(bills[index], ctx.today).errors);
      }
    }
    if (v._stage === "bill" && index != null) {
      bills[index] = fromForm(v, bills[index]);
      const errors = check(bills[index], ctx.today).errors;
      if (Object.keys(errors).length) return billForm(bills, index, errors);
    }

    // As on the Add VAT bill form, a bill with no date is dated today.
    bills = bills.map((bill) => (bill.bill_date ? bill : { ...bill, bill_date: ctx.today, dated_today: true }));
    const items = bills.map((bill) => check(bill, ctx.today));
    const ready = items.filter((item) => !Object.keys(item.errors).length);
    if (!ready.length) {
      const first = items.findIndex((item) => Object.keys(item.errors).length);
      return billForm(
        bills,
        first,
        items[first].errors,
        bills.length === 1 ? "A few details are needed before this bill can be added." : `None of these bills can be added yet. Bill ${first + 1} needs ${missing(items[first].errors)}.`
      );
    }

    const incomplete = items.flatMap((item, position) =>
      Object.keys(item.errors).length
        ? [`Bill ${label(item.bill, position)} needs ${missing(item.errors)}, so it will not be saved. Use Change something to fix it.`]
        : []
    );
    const datedToday = items.flatMap((item, position) =>
      item.bill.dated_today
        ? [`Bill ${label(item.bill, position)} had no date, so it is dated today, ${formatDate(ctx.today)}. Use Change something if it is from another day.`]
        : []
    );
    const warnings = [...incomplete, ...datedToday, ...duplicates(items, await existingBills(ctx)), ...vatWarnings(items)];
    const total = ready.reduce((sum, item) => sum + item.bill.total!, 0);
    const vat = ready.reduce((sum, item) => sum + item.vat, 0);
    const claimed = ready.reduce((sum, item) => sum + item.claimed, 0);
    const count = `${ready.length} ${ready.length === 1 ? "bill" : "bills"}`;

    return {
      status: "ready",
      summary: `Ready to add ${count}: ${money(total)} with VAT ${formatNumber(vat)}, of which ${formatNumber(claimed)} claimed. Check them and confirm.`,
      draft: {
        title: `Add ${count} to Bills`,
        confirmLabel: `Save ${count}`,
        rows: [
          ...items.map((item, position) => ({
            label: label(item.bill, position),
            value: Object.keys(item.errors).length
              ? `Not saved: needs ${missing(item.errors)}`
              : `${money(item.bill.total!)} · ${vatText(item)} · ${formatDate(item.bill.bill_date)}${item.bill.dated_today ? " (today)" : ""}${item.bill.reimburse ? " · pay back" : ""}`,
          })),
          { label: "Total", value: `${count} · ${money(total)} · VAT ${formatNumber(vat)} · claimed ${formatNumber(claimed)}` },
        ],
        warnings,
        // Every bill, the incomplete ones too, so "Change something" can fix them.
        args: { bills },
      },
    } satisfies ToolReady;
  },

  async execute(args, ctx) {
    const bills = Array.isArray(args.bills) ? (args.bills as unknown[]).slice(0, MAX_BILLS).map(toBill) : [];
    const ready = bills.map((bill) => check(bill, ctx.today)).filter((item) => !Object.keys(item.errors).length);
    if (!ready.length) return { ok: false, error: "none of the bills has everything it needs." };
    const result = await addCompanyBills(ready.map(toInput));
    if (result.error) return { ok: false, error: result.error };
    const count = `${ready.length} ${ready.length === 1 ? "bill" : "bills"}`;
    return { ok: true, text: `Added ${count} to Bills. Add each bill's photo from Bills → Edit.` };
  },
};
