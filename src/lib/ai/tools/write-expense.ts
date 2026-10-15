import { z } from "zod";
import { addExpense, updateExpense } from "@/app/(app)/expenses/actions";
import { fromPaisa, toPaisa } from "@/lib/money";
import type { AppUser, Category, Expense, MoneyAccount, Vendor } from "@/lib/types";
import { RequestData } from "../data";
import { formatDate, formatMonth, isValidDate } from "../dates";
import { money, truncate } from "../format";
import { matchOne, normalizeName } from "../match";
import type { FieldOption, FieldSpec } from "../types";
import { clean, isoDate } from "./common";
import type { ExecuteResult, ToolAsk, ToolContext, ToolReady, WriteTool } from "./types";

/**
 * Adding and correcting expenses. The rules are the Add/Edit expense forms':
 * required are amount (> 0), date, category, who paid (a team member, or a
 * company account), and for a USD charge paid from an NPR account the exact
 * NPR on the statement. Date defaults to today, currency to NPR and the payer
 * to the person asking, as on the form; all three show on the confirmation.
 * With no people tagged, a team-paid expense is a shared company cost, split
 * across core members exactly as when the form's tags are left empty.
 */

type Refs = {
  categories: Category[];
  vendors: Vendor[];
  users: AppUser[];
  accounts: MoneyAccount[];
  clientNames: string[];
};

async function refs(ctx: ToolContext): Promise<Refs> {
  const [categories, vendors, users, accounts, clients] = await Promise.all([
    ctx.data.categories(),
    ctx.data.vendors(),
    ctx.data.users(),
    ctx.data.moneyAccounts(),
    ctx.data.clients(),
  ]);
  return { categories, vendors, users, accounts, clientNames: clients.map((client) => client.name) };
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
}

/** Accounts that can pay an expense in this currency (as the form offers them). */
function payingAccounts(accounts: MoneyAccount[], currency: string) {
  return accounts.filter(
    (account) => account.is_active && (account.currency === currency || (currency === "USD" && account.currency === "NPR"))
  );
}

/** Equal shares in the expense's own currency; the last person takes the odd paisa. */
export function equalShares(amount: number, userIds: string[]): { userId: string; amount: number }[] {
  if (!userIds.length) return [];
  const total = toPaisa(amount);
  const base = Math.floor(total / userIds.length);
  return userIds.map((userId, index) => ({
    userId,
    amount: fromPaisa(index === userIds.length - 1 ? total - base * (userIds.length - 1) : base),
  }));
}

/** A name or an id the form sent, resolved to one record; `error` when unclear. */
function pick<T extends { id: string }>(
  items: T[],
  id: unknown,
  name: unknown,
  namesOf: (item: T) => string[]
): { item?: T; error?: string } {
  if (typeof id === "string" && id) {
    const item = items.find((candidate) => candidate.id === id);
    return item ? { item } : { error: "No longer available; choose again." };
  }
  if (typeof name === "string" && name.trim()) {
    const match = matchOne(items, namesOf, name);
    if (match.kind === "one") return { item: match.item };
    return { error: match.kind === "many" ? `"${name}" matches more than one; choose one.` : `Nothing called "${name}"; choose one.` };
  }
  return {};
}

const options = {
  categories: (r: Refs): FieldOption[] => r.categories.map((c) => ({ value: c.id, label: c.name })),
  vendors: (r: Refs): FieldOption[] => [{ value: "", label: "— No vendor —" }, ...r.vendors.map((v) => ({ value: v.id, label: v.name }))],
  users: (r: Refs): FieldOption[] => r.users.map((u) => ({ value: u.id, label: u.name })),
  clients: (r: Refs): FieldOption[] => [{ value: "", label: "— No client —" }, ...r.clientNames.map((name) => ({ value: name, label: name }))],
};

// ---------------------------------------------------------------------------

const createSchema = z.object({
  amount: z.number().positive().optional().describe("The amount, in the expense's currency"),
  currency: z.enum(["NPR", "USD"]).optional().describe("Omit for NPR"),
  date: isoDate.optional().describe("Expense date; omit if not said (the form defaults to today)"),
  category: z.string().max(80).optional().describe("Category name as said; omit if not said, never guess"),
  vendor: z.string().max(80).optional(),
  note: z.string().max(300).optional().describe("What it was for, e.g. 'Server maintenance'"),
  client: z.string().max(120).optional().describe("Client the cost was for, if said"),
  funding: z
    .enum(["personal", "company_funds"])
    .optional()
    .describe("personal = a team member paid with their own money; company_funds = paid from a company account. Omit if not said."),
  account: z.string().max(80).optional().describe("Company account name, when paid from a company account"),
  paid_by: z.string().max(80).optional().describe("Team member who paid; omit when it is the user"),
  tags: z
    .array(z.string().max(80))
    .max(10)
    .optional()
    .describe("People whose work used this money, for an exact equal split; omit for a shared company cost"),
  actual_npr_charged: z.number().positive().optional().describe("USD only: the exact NPR on the bank statement, if said"),
  billing_month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM the cost belongs to, if said"),
});

type NewExpense = {
  amount: number;
  currency: "NPR" | "USD";
  expense_date: string;
  category_id: string;
  vendor_id: string | null;
  funding_source: "personal" | "company_funds";
  money_account_id: string | null;
  paid_by_user_id: string | null;
  share_user_ids: string[];
  actual_npr_charged: number | null;
  client: string | null;
  note: string | null;
  billing_month: string | null;
};

export const createExpense: WriteTool = {
  name: "create_expense",
  label: "Add expense",
  kind: "write",
  permission: "member",
  description:
    "Prepare a new expense from what the user said. Pass only details the user gave; the app asks for anything missing in a form and always shows a confirmation before saving. Never claim it is saved.",
  schema: createSchema,
  async run(raw, ctx) {
    const v = clean(raw);
    const r = await refs(ctx);
    const errors: Record<string, string> = {};
    const defaulted: string[] = [];

    const amount = num(v.amount);
    if (amount != null && amount <= 0) errors.amount = "Must be more than zero.";
    const currency = v.currency === "USD" ? "USD" : "NPR";
    let date = str(v.expense_date) ?? str(v.date);
    if (date && !isValidDate(date)) {
      errors.expense_date = "Not a real date.";
      date = null;
    }
    if (!date && !errors.expense_date) {
      date = ctx.today;
      defaulted.push("date");
    }

    const vendor = v.vendor_id === "" ? {} : pick(r.vendors, v.vendor_id, v.vendor, (x) => [x.name]);
    if (vendor.error) errors.vendor_id = vendor.error;
    let category = pick(r.categories, v.category_id, v.category, (x) => [x.name]);
    if (category.error) errors.category_id = category.error;
    if (!category.item && !category.error && vendor.item?.category_id) {
      const fromVendor = r.categories.find((c) => c.id === vendor.item!.category_id);
      if (fromVendor) category = { item: fromVendor };
    }

    const fundingSource =
      v.funding_source === "personal" || v.funding_source === "company_funds"
        ? v.funding_source
        : v.funding === "personal" || v.funding === "company_funds"
          ? v.funding
          : null;
    const accounts = payingAccounts(r.accounts, currency);
    let account: { item?: MoneyAccount; error?: string } = {};
    let payer: { item?: AppUser; error?: string } = {};
    if (fundingSource === "company_funds") {
      account = pick(accounts, v.money_account_id, v.account, (x) => [x.name]);
      if (account.error) errors.money_account_id = account.error;
      if (!account.item && !account.error && accounts.length === 1) account = { item: accounts[0] };
    } else if (fundingSource === "personal") {
      payer = pick(r.users, v.paid_by_user_id, v.paid_by, (x) => [x.name, x.email]);
      if (payer.error) errors.paid_by_user_id = payer.error;
      if (!payer.item && !payer.error) {
        payer = { item: r.users.find((user) => user.id === ctx.session.sub) };
        defaulted.push("payer");
      }
    }

    // Tagged people: ids from the form, or names from the request.
    let shareIds = ids(v.share_user_ids);
    if (!shareIds.length && Array.isArray(v.tags)) {
      const unknown: string[] = [];
      for (const name of v.tags as string[]) {
        const match = matchOne(r.users, (x) => [x.name, x.email], name);
        if (match.kind === "one") shareIds.push(match.item.id);
        else unknown.push(name);
      }
      if (unknown.length) errors.share_user_ids = `Could not tell who "${unknown.join('", "')}" is; choose the people.`;
    }
    shareIds = [...new Set(shareIds)].filter((id) => r.users.some((user) => user.id === id));
    if (fundingSource === "company_funds") shareIds = [];

    const actualNpr = num(v.actual_npr_charged);
    const needsActualNpr = currency === "USD" && account.item?.currency === "NPR";
    const clientTag = str(v.client);
    const billingMonth = str(v.billing_month);
    if (billingMonth && !/^\d{4}-\d{2}$/.test(billingMonth)) errors.billing_month = "Use a month.";

    const missing: string[] = [];
    if (amount == null) missing.push("amount");
    if (!category.item) missing.push("category_id");
    if (!fundingSource) missing.push("funding_source");
    if (fundingSource === "company_funds" && !account.item) missing.push("money_account_id");
    if (fundingSource === "personal" && !payer.item) missing.push("paid_by_user_id");
    if (needsActualNpr && actualNpr == null) missing.push("actual_npr_charged");

    // A defaulted value stays unset in the form's hidden values, so the next
    // round defaults it again and the confirmation still says so.
    const showAll = v._edit === true || v._edit === "true";
    const values: Record<string, unknown> = {
      amount: amount ?? "",
      currency,
      expense_date: !showAll && defaulted.includes("date") ? "" : date ?? "",
      category_id: category.item?.id ?? "",
      vendor_id: vendor.item?.id ?? "",
      funding_source: fundingSource ?? "",
      money_account_id: account.item?.id ?? "",
      paid_by_user_id: !showAll && defaulted.includes("payer") ? "" : payer.item?.id ?? "",
      share_user_ids: shareIds,
      actual_npr_charged: actualNpr ?? "",
      client: clientTag ?? "",
      note: str(v.note) ?? "",
      billing_month: billingMonth ?? "",
    };

    if (missing.length || Object.keys(errors).length || showAll) {
      const fields = expenseFields(r, values, { currency, fundingSource, needsActualNpr, accounts })
        .filter((field) => showAll || missing.includes(field.name) || errors[field.name])
        .map((field) => ({ ...field, error: errors[field.name] }));
      // Fields shown in the form must stay editable, so their names drive the next run.
      return {
        status: "needs_input",
        summary: showAll ? "Edit the expense, then review it again." : "A few details are needed before this expense can be saved.",
        form: {
          tool: "create_expense",
          title: showAll ? "Edit expense" : "Expense details",
          message: showAll ? undefined : "Fill in what's missing. Nothing is saved until you confirm.",
          values: { ...values, _edit: false },
          fields,
          submitLabel: "Next",
        },
      } satisfies ToolAsk;
    }

    const expense: NewExpense = {
      amount: amount!,
      currency,
      expense_date: date!,
      category_id: category.item!.id,
      vendor_id: vendor.item?.id ?? null,
      funding_source: fundingSource!,
      money_account_id: fundingSource === "company_funds" ? account.item!.id : null,
      paid_by_user_id: fundingSource === "personal" ? payer.item!.id : null,
      share_user_ids: shareIds,
      actual_npr_charged: currency === "USD" ? actualNpr : null,
      client: clientTag,
      note: str(v.note),
      billing_month: billingMonth,
    };
    const shares = equalShares(expense.amount, expense.share_user_ids);
    const userName = (id: string | null) => r.users.find((user) => user.id === id)?.name ?? "—";
    const warnings: string[] = [];
    if (defaulted.includes("date")) warnings.push("No date was given, so it is dated today.");
    if (currency === "USD" && expense.actual_npr_charged == null) {
      warnings.push("The NPR amount will be set from the NRB rate for that date when it is saved.");
    }

    return {
      status: "ready",
      summary: `Ready to add ${money(expense.amount, currency)} for ${category.item!.name}. Please confirm.`,
      draft: {
        title: "Confirm expense",
        confirmLabel: "Save expense",
        rows: [
          { label: "Amount", value: money(expense.amount, currency) },
          ...(expense.actual_npr_charged != null ? [{ label: "NPR charged", value: money(expense.actual_npr_charged) }] : []),
          { label: "Date", value: `${formatDate(expense.expense_date)}${defaulted.includes("date") ? " (today)" : ""}` },
          { label: "Category", value: category.item!.name },
          ...(vendor.item ? [{ label: "Vendor", value: vendor.item.name }] : []),
          fundingSource === "company_funds"
            ? { label: "Paid from", value: account.item!.name }
            : { label: "Paid by", value: `${userName(expense.paid_by_user_id)}${defaulted.includes("payer") ? " (you)" : ""} · team money` },
          ...(fundingSource === "personal"
            ? [
                {
                  label: "Split",
                  value: shares.length
                    ? shares.map((share) => `${userName(share.userId)} ${money(share.amount, currency)}`).join(" · ")
                    : "Shared company cost (core members)",
                },
              ]
            : []),
          ...(expense.client ? [{ label: "Client", value: expense.client }] : []),
          ...(expense.note ? [{ label: "Description", value: expense.note }] : []),
          ...(expense.billing_month ? [{ label: "Billing month", value: formatMonth(expense.billing_month) }] : []),
        ],
        warnings,
        args: expense as unknown as Record<string, unknown>,
      },
    } satisfies ToolReady;
  },

  async execute(args) {
    const expense = args as unknown as NewExpense;
    const form = new FormData();
    form.set("amount", String(expense.amount));
    form.set("currency", expense.currency);
    form.set("expense_date", expense.expense_date);
    form.set("category_id", expense.category_id);
    form.set("vendor_id", expense.vendor_id ?? "");
    form.set("funding_source", expense.funding_source);
    if (expense.money_account_id) form.set("money_account_id", expense.money_account_id);
    if (expense.paid_by_user_id) form.set("paid_by_user_id", expense.paid_by_user_id);
    if (expense.actual_npr_charged != null) form.set("actual_npr_charged", String(expense.actual_npr_charged));
    form.set("client", expense.client ?? "");
    form.set("note", expense.note ?? "");
    form.set("billing_month", expense.billing_month ?? "");
    for (const share of equalShares(expense.amount, expense.share_user_ids ?? [])) {
      form.append("share_user_id", share.userId);
      form.append("share_amount", String(share.amount));
    }
    const result = await addExpense(form);
    if (result.error) return { ok: false, error: result.error };
    const label = `${money(expense.amount, expense.currency)} on ${formatDate(expense.expense_date)}${expense.note ? ` (${expense.note})` : ""}`;
    return {
      ok: true,
      text: `Saved: ${label}.`,
      recordId: result.id,
      record: result.id ? { kind: "expense", id: result.id, label: `expense ${label}` } : undefined,
    };
  },
};

function expenseFields(
  r: Refs,
  values: Record<string, unknown>,
  ctx: { currency: string; fundingSource: string | null; needsActualNpr: boolean; accounts: MoneyAccount[] }
): FieldSpec[] {
  const s = (name: string) => (values[name] == null ? "" : String(values[name]));
  return [
    { name: "amount", label: "Amount", type: "number", required: true, min: 0.01, step: 0.01, value: s("amount") },
    {
      name: "currency",
      label: "Currency",
      type: "select",
      required: true,
      options: [
        { value: "NPR", label: "NPR" },
        { value: "USD", label: "USD" },
      ],
      value: s("currency"),
    },
    { name: "expense_date", label: "Date", type: "date", required: true, value: s("expense_date") },
    { name: "category_id", label: "Category", type: "select", required: true, options: options.categories(r), value: s("category_id") },
    { name: "vendor_id", label: "Vendor", type: "select", required: false, options: options.vendors(r), value: s("vendor_id") },
    {
      name: "funding_source",
      label: "Who paid?",
      type: "choice",
      required: true,
      options: [
        { value: "personal", label: "A team member", hint: "Founder/team money, reimbursable" },
        { value: "company_funds", label: "A company account", hint: "Company operating money" },
      ],
      value: s("funding_source"),
    },
    {
      name: "money_account_id",
      label: "Company account",
      type: "select",
      required: ctx.fundingSource === "company_funds",
      options: ctx.accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
      value: s("money_account_id"),
      help: "Only when a company account paid.",
    },
    {
      name: "paid_by_user_id",
      label: "Paid by",
      type: "select",
      required: ctx.fundingSource === "personal",
      options: options.users(r),
      value: s("paid_by_user_id"),
      help: "Only when a team member paid.",
    },
    {
      name: "actual_npr_charged",
      label: "NPR charged",
      type: "number",
      required: ctx.needsActualNpr,
      min: 0.01,
      step: 0.01,
      value: s("actual_npr_charged"),
      help: "For a USD charge: the exact NPR on the bank statement.",
    },
    {
      name: "share_user_ids",
      label: "Whose work used this money",
      type: "multiselect",
      required: false,
      options: options.users(r),
      value: Array.isArray(values.share_user_ids) ? (values.share_user_ids as string[]) : [],
      help: "Leave empty for a shared company cost (split across core members).",
    },
    { name: "client", label: "Client", type: "select", required: false, options: options.clients(r), value: s("client") },
    { name: "note", label: "Description", type: "text", required: false, value: s("note"), placeholder: "Server maintenance" },
    { name: "billing_month", label: "Billing month", type: "month", required: false, value: s("billing_month") },
  ];
}

// ---------------------------------------------------------------------------

// No id here: the model cannot know one. "That expense" means just_saved; any
// other is found from the match_* details. Ids come only from the panel's forms.
const updateSchema = z.object({
  just_saved: z
    .boolean()
    .optional()
    .describe("true when the user means the expense saved a moment ago in this conversation"),
  match_date: isoDate.optional().describe("Date of the expense to change, if said"),
  match_amount: z.number().positive().optional().describe("Current amount of the expense to change, if said"),
  match_text: z.string().max(80).optional().describe("Words identifying it: vendor, category or description"),
  new_amount: z.number().positive().optional(),
  new_date: isoDate.optional(),
  new_category: z.string().max(80).optional(),
  new_vendor: z.string().max(80).optional(),
  new_note: z.string().max(300).optional(),
  new_client: z.string().max(120).optional(),
  new_billing_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const EDITABLE = ["amount", "expense_date", "category_id", "vendor_id", "note", "client", "billing_month"] as const;
type Editable = (typeof EDITABLE)[number];

function describeExpense(expense: Expense, r: Refs): string {
  const vendor = r.vendors.find((v) => v.id === expense.vendor_id)?.name;
  const category = r.categories.find((c) => c.id === expense.category_id)?.name;
  return [formatDate(expense.expense_date), vendor ?? category ?? "Expense", money(Number(expense.amount), expense.currency), truncate(expense.note, 32)]
    .filter(Boolean)
    .join(" · ");
}

function editableValue(expense: Expense, field: Editable): string {
  switch (field) {
    case "amount":
      return String(Number(expense.amount));
    case "billing_month":
      return expense.billing_month ? expense.billing_month.slice(0, 7) : "";
    default:
      return String(expense[field] ?? "");
  }
}

export const updateExpenseTool: WriteTool = {
  name: "update_expense",
  label: "Edit expense",
  kind: "write",
  permission: "admin",
  description:
    "Prepare a correction to an existing expense (amount, date, category, vendor, description, client, billing month). Identify it with match_* details; the app asks which one when several fit, and always shows old → new for confirmation. Never claim it is changed.",
  schema: updateSchema,
  async run(raw, ctx) {
    const v = clean(raw);
    if (v.just_saved === true && !v.expense_id) {
      const last = ctx.conversation?.lastRecord;
      if (last?.kind !== "expense") {
        return {
          status: "error",
          summary: "I haven't saved an expense in this chat yet. Tell me its date, amount or what it was for.",
        };
      }
      v.expense_id = last.id;
    }
    const [expenses, shares, r] = await Promise.all([ctx.data.expenses(), ctx.data.expenseShares(), refs(ctx)]);

    let expense = typeof v.expense_id === "string" ? expenses.find((e) => e.id === v.expense_id) : undefined;
    if (typeof v.expense_id === "string" && !expense) return { status: "error", summary: "That expense no longer exists." };
    if (!expense) {
      let candidates = expenses;
      if (typeof v.match_date === "string") candidates = candidates.filter((e) => e.expense_date === v.match_date);
      const matchAmount = num(v.match_amount);
      if (matchAmount != null) {
        const wanted = toPaisa(matchAmount);
        candidates = candidates.filter((e) => toPaisa(e.amount) === wanted || toPaisa(e.amount_npr) === wanted);
      }
      if (typeof v.match_text === "string") {
        const words = normalizeName(v.match_text).split(" ");
        candidates = candidates.filter((e) => {
          const text = normalizeName(
            [describeExpense(e, r), e.note, e.client, r.categories.find((c) => c.id === e.category_id)?.name].join(" ")
          );
          return words.every((word) => text.includes(word));
        });
      }
      const hasCriteria = ["match_date", "match_amount", "match_text"].some((key) => key in v);
      if (hasCriteria && candidates.length === 1) expense = candidates[0];
      else if (hasCriteria && candidates.length === 0) {
        return { status: "error", summary: "No expense matches that. Try the date, amount or vendor shown on the Expenses page." };
      } else {
        const list = (hasCriteria ? candidates : expenses).slice(0, 15);
        return {
          status: "needs_choice",
          summary: hasCriteria ? "More than one expense matches. Which one?" : "Which expense should change?",
          form: {
            tool: "update_expense",
            title: "Which expense?",
            message: hasCriteria ? "More than one expense matches." : "Pick the expense to change (most recent first).",
            values: { ...v, expense_id: undefined },
            fields: [
              {
                name: "expense_id",
                label: "Expense",
                type: "choice",
                required: true,
                options: list.map((e) => ({ value: e.id, label: describeExpense(e, r) })),
              },
            ],
            submitLabel: "Continue",
          },
        };
      }
    }

    // The new values: form fields (ids) or new_* details from the request.
    const showAll = v._edit === true || v._edit === "true";
    const errors: Record<string, string> = {};
    const next: Partial<Record<Editable, string>> = {};
    const fromForm = (field: Editable) => (field in v ? String(v[field] ?? "") : undefined);
    const amount = fromForm("amount") ?? (v.new_amount != null ? String(v.new_amount) : undefined);
    if (amount !== undefined) {
      const n = num(amount);
      if (n == null || n <= 0) errors.amount = "Must be more than zero.";
      else next.amount = String(n);
    }
    const date = fromForm("expense_date") ?? str(v.new_date) ?? undefined;
    if (date !== undefined) {
      if (!isValidDate(date)) errors.expense_date = "Not a real date.";
      else next.expense_date = date;
    }
    if ("category_id" in v || v.new_category) {
      const found = pick(r.categories, v.category_id, v.new_category, (x) => [x.name]);
      if (found.error) errors.category_id = found.error;
      else if (found.item) next.category_id = found.item.id;
    }
    if ("vendor_id" in v || v.new_vendor) {
      if (v.vendor_id === "") next.vendor_id = "";
      else {
        const found = pick(r.vendors, v.vendor_id, v.new_vendor, (x) => [x.name]);
        if (found.error) errors.vendor_id = found.error;
        else if (found.item) next.vendor_id = found.item.id;
      }
    }
    const note = fromForm("note") ?? str(v.new_note) ?? undefined;
    if (note !== undefined) next.note = note;
    const client = fromForm("client") ?? str(v.new_client) ?? undefined;
    if (client !== undefined) next.client = client;
    const month = fromForm("billing_month") ?? str(v.new_billing_month) ?? undefined;
    if (month !== undefined) {
      if (month && !/^\d{4}-\d{2}$/.test(month)) errors.billing_month = "Use a month.";
      else next.billing_month = month;
    }

    const current = expense;
    const changes = Object.fromEntries(
      Object.entries(next).filter(([field, value]) => value !== editableValue(current, field as Editable))
    ) as Partial<Record<Editable, string>>;

    const hasShares = shares.some((share) => share.expense_id === current.id);
    if (changes.amount && hasShares) {
      return {
        status: "error",
        summary:
          "This expense is split between people, so changing its amount means re-dividing the split. Edit it on the Expenses page instead.",
      };
    }

    if (!Object.keys(changes).length || Object.keys(errors).length || showAll) {
      const values: Record<string, unknown> = { expense_id: current.id, _edit: false };
      for (const field of EDITABLE) values[field] = next[field] ?? editableValue(current, field);
      const fields: FieldSpec[] = [
        { name: "amount", label: `Amount (${current.currency})`, type: "number", required: true, min: 0.01, step: 0.01, value: String(values.amount) },
        { name: "expense_date", label: "Date", type: "date", required: true, value: String(values.expense_date) },
        { name: "category_id", label: "Category", type: "select", required: true, options: options.categories(r), value: String(values.category_id) },
        { name: "vendor_id", label: "Vendor", type: "select", required: false, options: options.vendors(r), value: String(values.vendor_id) },
        { name: "note", label: "Description", type: "text", required: false, value: String(values.note) },
        { name: "client", label: "Client", type: "select", required: false, options: options.clients(r), value: String(values.client) },
        { name: "billing_month", label: "Billing month", type: "month", required: false, value: String(values.billing_month) },
      ].map((field) => ({ ...field, error: errors[field.name] })) as FieldSpec[];
      return {
        status: "needs_input",
        summary: Object.keys(errors).length ? "Some of the new values need fixing." : "What should change on this expense?",
        form: {
          tool: "update_expense",
          title: "Change expense",
          message: describeExpense(current, r),
          values,
          fields,
          submitLabel: "Next",
        },
      };
    }

    const label = (field: Editable, value: string) => {
      if (field === "amount") return money(Number(value), current.currency);
      if (field === "expense_date") return formatDate(value);
      if (field === "category_id") return r.categories.find((c) => c.id === value)?.name ?? "—";
      if (field === "vendor_id") return r.vendors.find((x) => x.id === value)?.name ?? "—";
      if (field === "billing_month") return value ? formatMonth(value) : "—";
      return value || "—";
    };
    const NAMES: Record<Editable, string> = {
      amount: "Amount",
      expense_date: "Date",
      category_id: "Category",
      vendor_id: "Vendor",
      note: "Description",
      client: "Client",
      billing_month: "Billing month",
    };
    const warnings: string[] = [];
    if ((changes.amount || changes.expense_date) && current.currency === "USD" && current.fx_source !== "actual" && current.fx_source !== "manual") {
      warnings.push("This is a USD expense: its NPR amount will be recalculated from the NRB rate.");
    }
    return {
      status: "ready",
      summary: `Ready to change ${describeExpense(current, r)}. Please confirm.`,
      draft: {
        title: "Confirm change",
        confirmLabel: "Save change",
        rows: [
          { label: "Expense", value: describeExpense(current, r) },
          ...(Object.entries(changes) as [Editable, string][]).map(([field, value]) => ({
            label: NAMES[field],
            value: `${label(field, editableValue(current, field))} → ${label(field, value)}`,
          })),
        ],
        warnings,
        // Flat, so "Edit" can send it back as form values.
        args: { expense_id: current.id, ...changes },
      },
    };
  },

  async execute(args, ctx): Promise<ExecuteResult> {
    const { expense_id: rawId, ...rest } = args;
    const id = String(rawId ?? "");
    const changes = Object.fromEntries(
      Object.entries(rest).filter(([field]) => (EDITABLE as readonly string[]).includes(field))
    ) as Partial<Record<Editable, string>>;
    // Re-read: the edit applies to the expense as it is now, not as it was shown.
    const fresh = new RequestData(ctx.today);
    const [expenses, shares] = await Promise.all([fresh.expenses(), fresh.expenseShares()]);
    const expense = expenses.find((e) => e.id === id);
    if (!expense) return { ok: false, error: "That expense no longer exists." };
    const ownShares = shares.filter((share) => share.expense_id === id);
    if (changes.amount && ownShares.length) {
      return { ok: false, error: "This expense is split between people; change its amount on the Expenses page." };
    }

    // updateExpense replaces the whole record, so every current value is sent
    // and only the confirmed fields differ: the split, the payer, the account
    // and the exchange-rate basis stay exactly as they are.
    const form = new FormData();
    form.set("expense_id", id);
    form.set("amount", changes.amount ?? String(Number(expense.amount)));
    form.set("currency", expense.currency);
    form.set("expense_date", changes.expense_date ?? expense.expense_date);
    form.set("funding_source", expense.funding_source);
    if (expense.money_account_id) form.set("money_account_id", expense.money_account_id);
    if (expense.paid_by_user_id) form.set("paid_by_user_id", expense.paid_by_user_id);
    if (expense.currency === "USD" && expense.actual_npr_charged != null) {
      form.set("actual_npr_charged", String(Number(expense.actual_npr_charged)));
    }
    if (expense.currency === "USD" && expense.fx_source === "manual") {
      form.set("manual_rate", String(Number(expense.fx_rate_to_npr)));
    }
    form.set("billing_month", changes.billing_month ?? editableValue(expense, "billing_month"));
    form.set("category_id", changes.category_id ?? expense.category_id ?? "");
    form.set("vendor_id", changes.vendor_id ?? expense.vendor_id ?? "");
    form.set("client", changes.client ?? expense.client ?? "");
    form.set("note", changes.note ?? expense.note ?? "");
    for (const share of ownShares) {
      form.append("share_user_id", share.user_id);
      form.append("share_amount", String(Number(share.amount)));
    }
    const result = await updateExpense(form);
    if (result.error) return { ok: false, error: result.error };
    const amount = Number(changes.amount ?? expense.amount);
    const label = `${money(amount, expense.currency)} on ${formatDate(changes.expense_date ?? expense.expense_date)}`;
    return { ok: true, text: `Updated: the expense is now ${label}.`, recordId: id, record: { kind: "expense", id, label: `expense ${label}` } };
  },
};
