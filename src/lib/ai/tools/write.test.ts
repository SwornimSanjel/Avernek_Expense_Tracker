import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeIncomeAgreement } from "@/lib/income";
import type { AppUser, Category, IncomeAgreement, IncomePayment, MoneyAccount, Vendor } from "@/lib/types";
import type { Client, RequestData } from "../data";
import type { ToolContext } from "./types";

// The save actions are the app's own; here they only record what they receive.
const saved = vi.hoisted(() => ({ forms: [] as FormData[] }));
vi.mock("@/app/(app)/expenses/actions", () => ({
  addExpense: vi.fn(async (form: FormData) => {
    saved.forms.push(form);
    return { error: null, id: "new-expense" };
  }),
  updateExpense: vi.fn(async (form: FormData) => {
    saved.forms.push(form);
    return { error: null };
  }),
}));
vi.mock("@/app/(app)/income/actions", () => ({
  recordIncomePayment: vi.fn(async (_state: unknown, form: FormData) => {
    saved.forms.push(form);
    return { error: null, ok: "Payment recorded for Kalika Technical." };
  }),
  updateIncomePayment: vi.fn(async (_state: unknown, form: FormData) => {
    saved.forms.push(form);
    return { error: null, ok: "Payment updated." };
  }),
}));

const { createExpense, equalShares } = await import("./write-expense");
const { recordClientPayment } = await import("./write-payment");

const TODAY = "2026-10-15";
const users: AppUser[] = [
  { id: "u-pragyan", name: "Pragyan Maharjan", email: "pragyan@avernek.com", is_core_member: true, is_admin: true },
  { id: "u-swornim", name: "Swornim Sanjel", email: "swornim@avernek.com", is_core_member: true, is_admin: true },
];
const categories: Category[] = [
  { id: "c-hosting", name: "Hosting", color: "#000", monthly_budget: null },
  { id: "c-software", name: "Software", color: "#000", monthly_budget: null },
];
const vendors: Vendor[] = [{ id: "v-contabo", name: "Contabo", category_id: "c-hosting", default_currency: "USD" }];
const account = (id: string, name: string, kind: MoneyAccount["kind"], currency: "NPR" | "USD" = "NPR"): MoneyAccount => ({
  id,
  name,
  kind,
  currency,
  holder_name: null,
  notes: null,
  is_active: true,
  created_at: "2026-07-01T00:00:00.000Z",
});
const accounts = [account("a-bank", "NIC Asia (VAT)", "company_bank"), account("a-custody", "Swornim custody", "personal_custody")];

const kalika: IncomeAgreement = {
  id: "ag-kalika",
  client_name: "Kalika Technical",
  agreement_name: null,
  service_type: "website",
  has_website: true,
  has_ads: false,
  has_automation: false,
  contact_name: null,
  agreement_date: "2026-08-01",
  work_start_date: "2026-08-05",
  contract_end_date: null,
  deducts_tds: true,
  default_money_account_id: "a-bank",
  currency: "NPR",
  setup_amount: 0,
  setup_payment_terms: "full_upfront",
  setup_advance_percent: 0,
  setup_due_date: null,
  setup_paid_in_full_date: null,
  setup_notes: null,
  website_amount: 80000,
  website_status: "completed",
  website_start_date: "2026-08-05",
  website_expected_date: null,
  website_completed_date: "2026-09-20",
  website_due_date: "2026-09-20",
  website_paid_in_full_date: null,
  website_notes: null,
  ads_status: "not_started",
  ads_prep_start_date: null,
  ads_live_date: null,
  ads_monthly_amount: null,
  ads_billing_start_date: null,
  ads_notes: null,
  automation_status: "not_started",
  automation_live_date: null,
  automation_monthly_amount: null,
  automation_billing_start_date: null,
  automation_notes: null,
  recurring_billing_mode: "combined",
  recurring_amount: 0,
  recurring_billing_start_date: null,
  setup_covers_first_cycle: false,
  recurring_due_days_before: 0,
  status: "active",
  service_end_date: null,
  notes: null,
  created_by: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
} as unknown as IncomeAgreement;

const paid30k: IncomePayment = {
  id: "p-1",
  agreement_id: "ag-kalika",
  payment_for: "website",
  billing_period_start: null,
  billing_stream: null,
  amount: 30000,
  vat_amount: 3900,
  tds_amount: 450,
  paid_on: "2026-09-25",
  received_in: "company",
  money_account_id: "a-bank",
  account_name: "NIC Asia (VAT)",
  method: "bank_transfer",
  reference: null,
  note: null,
  recorded_by: "u-pragyan",
  created_at: "2026-09-25T00:00:00.000Z",
  updated_by: null,
  updated_at: "2026-09-25T00:00:00.000Z",
};

function context(isAdmin = true): ToolContext {
  const agreements = [kalika];
  const payments = [paid30k];
  const clients: Client[] = [{ name: "Kalika Technical", agreements }];
  const data = {
    today: TODAY,
    categories: async () => categories,
    vendors: async () => vendors,
    users: async () => users,
    moneyAccounts: async () => accounts,
    clients: async () => clients,
    agreements: async () => agreements,
    payments: async () => payments,
    summaries: async () => new Map(agreements.map((a) => [a.id, summarizeIncomeAgreement(a, payments, TODAY)])),
  } as unknown as RequestData;
  return { session: { sub: "u-pragyan", email: "pragyan@avernek.com", name: "Pragyan", isAdmin, exp: 0 }, today: TODAY, data };
}

const fields = (outcome: { status: string; form?: { fields: { name: string }[] } }) => outcome.form?.fields.map((f) => f.name);
const rows = (outcome: { draft?: { rows: { label: string; value: string }[] } }) =>
  Object.fromEntries((outcome.draft?.rows ?? []).map((row) => [row.label, row.value]));

beforeEach(() => {
  saved.forms.length = 0;
});

describe("equalShares", () => {
  it("splits to the paisa, the last person taking the remainder", () => {
    expect(equalShares(100, ["a", "b", "c"])).toEqual([
      { userId: "a", amount: 33.33 },
      { userId: "b", amount: 33.33 },
      { userId: "c", amount: 33.34 },
    ]);
  });
});

describe("create_expense", () => {
  it("asks only for what is missing: 'Add NPR 2,500 for server maintenance'", async () => {
    const outcome = await createExpense.run({ amount: 2500, note: "Server maintenance" }, context());
    expect(outcome.status).toBe("needs_input");
    expect(fields(outcome as never)).toEqual(["category_id", "funding_source"]);
    // Known values travel with the form, so nothing is asked twice; the date
    // was defaulted, so it stays unset and is defaulted (and flagged) again.
    const values = (outcome as { form: { values: Record<string, unknown> } }).form.values;
    expect(values).toMatchObject({ amount: 2500, note: "Server maintenance", expense_date: "" });

    const submitted = await createExpense.run({ ...values, category_id: "c-hosting", funding_source: "personal" }, context());
    expect(submitted.status).toBe("ready");
    expect(rows(submitted as never)).toMatchObject({ Date: "15 Oct 2026 (today)", "Paid by": "Pragyan Maharjan (you) · team money" });
    expect((submitted as { draft: { warnings: string[] } }).draft.warnings).toContain("No date was given, so it is dated today.");
  });

  it("takes the category from the vendor, as the form does", async () => {
    const outcome = await createExpense.run({ amount: 20, currency: "USD", vendor: "contabo", funding: "personal" }, context());
    expect(outcome.status).toBe("ready");
    expect(rows(outcome as never)).toMatchObject({ Category: "Hosting", Vendor: "Contabo", Amount: "USD 20.00" });
  });

  it("asks which category when the name is unclear, and never guesses", async () => {
    const outcome = await createExpense.run({ amount: 500, category: "Travel", funding: "personal" }, context());
    expect(outcome.status).toBe("needs_input");
    expect((outcome as { form: { fields: { name: string; error?: string }[] } }).form.fields).toEqual([
      expect.objectContaining({ name: "category_id", error: expect.stringContaining("Travel") }),
    ]);
  });

  it("shows every default on the confirmation", async () => {
    const outcome = await createExpense.run({ amount: 3500, category: "hosting", funding: "personal", note: "Hosting" }, context());
    expect(outcome.status).toBe("ready");
    expect(rows(outcome as never)).toMatchObject({
      Amount: "NPR 3,500",
      Date: "15 Oct 2026 (today)",
      Category: "Hosting",
      "Paid by": "Pragyan Maharjan (you) · team money",
      Split: "Shared company cost (core members)",
      Description: "Hosting",
    });
  });

  it("needs the exact NPR for a USD charge paid from an NPR account", async () => {
    const outcome = await createExpense.run(
      { amount: 20, currency: "USD", category: "Software", funding: "company_funds", account: "NIC Asia" },
      context()
    );
    expect(fields(outcome as never)).toEqual(["actual_npr_charged"]);
  });

  it("saves through addExpense with an exact split for tagged people", async () => {
    const outcome = await createExpense.run(
      { amount: 1000, category: "Hosting", funding: "personal", tags: ["Pragyan", "Swornim"] },
      context()
    );
    expect(outcome.status).toBe("ready");
    const result = await createExpense.execute((outcome as { draft: { args: Record<string, unknown> } }).draft.args, context());
    expect(result).toEqual({ ok: true, text: "Expense saved: NPR 1,000.", recordId: "new-expense" });
    const form = saved.forms[0];
    expect(form.get("amount")).toBe("1000");
    expect(form.get("category_id")).toBe("c-hosting");
    expect(form.get("funding_source")).toBe("personal");
    expect(form.get("paid_by_user_id")).toBe("u-pragyan");
    expect(form.getAll("share_user_id")).toEqual(["u-pragyan", "u-swornim"]);
    expect(form.getAll("share_amount")).toEqual(["500", "500"]);
  });
});

describe("record_client_payment", () => {
  it("applies the form's VAT and TDS defaults: 'Kalika paid 50,000'", async () => {
    const outcome = await recordClientPayment.run({ client: "kalika", amount: 50000 }, context());
    expect(outcome.status).toBe("ready");
    expect(rows(outcome as never)).toMatchObject({
      Client: "Kalika Technical",
      For: "Website",
      "Bill amount (excl. VAT)": "NPR 50,000",
      VAT: "NPR 6,500",
      "TDS withheld": "NPR 750",
      "Reaches the bank": "NPR 55,750",
      "Received in": "NIC Asia (VAT) (client's default)",
      "Date received": "15 Oct 2026 (today)",
      "Still owed on this after": "NPR 0",
    });
  });

  it("works back from the amount that reached the bank", async () => {
    const outcome = await recordClientPayment.run({ client: "Kalika Technical", amount: 55750, amount_basis: "bank" }, context());
    expect(rows(outcome as never)).toMatchObject({ "Bill amount (excl. VAT)": "NPR 50,000", "Reaches the bank": "NPR 55,750" });
  });

  it("refuses more than is owed, with the remaining amount", async () => {
    const outcome = await recordClientPayment.run({ client: "Kalika", amount: 60000 }, context());
    expect(outcome.status).toBe("needs_input");
    expect((outcome as { form: { fields: { name: string; error?: string }[] } }).form.fields).toEqual([
      expect.objectContaining({ name: "amount", error: "Only NPR 50,000 is still owed on this (excluding VAT)." }),
    ]);
  });

  it("follows what the user said about VAT", async () => {
    const outcome = await recordClientPayment.run({ client: "Kalika", amount: 10000, vat: "no", tds: "no" }, context());
    expect(rows(outcome as never)).toMatchObject({ VAT: "No VAT", "TDS withheld": "No TDS", "Reaches the bank": "NPR 10,000" });
  });

  it("asks for the amount when it was not said", async () => {
    const outcome = await recordClientPayment.run({ client: "Kalika" }, context());
    expect(fields(outcome as never)).toEqual(["amount"]);
  });

  it("asks which client when the name fits none", async () => {
    const outcome = await recordClientPayment.run({ client: "Himalayan Traders", amount: 100 }, context());
    expect(outcome.status).toBe("needs_choice");
  });

  it("records through recordIncomePayment with the confirmed values", async () => {
    const outcome = await recordClientPayment.run({ client: "Kalika", amount: 50000, reference: "TXN-42" }, context());
    const result = await recordClientPayment.execute((outcome as { draft: { args: Record<string, unknown> } }).draft.args, context());
    expect(result).toEqual({ ok: true, text: "Payment recorded for Kalika Technical." });
    const form = saved.forms[0];
    expect(Object.fromEntries(form.entries())).toMatchObject({
      agreement_id: "ag-kalika",
      payment_for: "website",
      amount: "50000",
      vat_amount: "6500",
      tds_amount: "750",
      paid_on: TODAY,
      money_account_id: "a-bank",
      method: "bank_transfer",
      reference: "TXN-42",
    });
  });
});
