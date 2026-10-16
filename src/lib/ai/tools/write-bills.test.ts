import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestData } from "../data";
import type { ToolContext } from "./types";

// The save action is the app's own; here it only records what it receives.
const saved = vi.hoisted(() => ({ batches: [] as unknown[][], error: null as string | null }));
vi.mock("@/app/(app)/funds/actions", () => ({
  addCompanyBills: vi.fn(async (bills: unknown[]) => {
    if (saved.error) return { error: saved.error, ok: null };
    saved.batches.push(bills);
    return { error: null, ok: `${bills.length} bills added.` };
  }),
}));

const { addCompanyBillsTool: tool } = await import("./write-bills");

const TODAY = "2026-10-16";
const existing = [
  { description: "Company incorporation", vendor_name: "Summit Legal Advisory", bill_number: "009", bill_date: "2026-09-22", total_amount: "20340.00" },
];

function context(): ToolContext {
  const data = { today: TODAY, companyBills: async () => existing } as unknown as RequestData;
  return { session: { sub: "u-admin", email: "admin@avernek.com", name: "Admin", isAdmin: true, exp: 0 }, today: TODAY, data };
}

const lunch = { description: "Team lunch", vendor: "Malaya Cafe & Restaurant", bill_no: "189", total: 1040, bill_date: "2026-08-12", vat_amount: 120 };
const coffee = { description: "Coffee meeting", vendor: "Origin Coffee Pvt. Ltd.", bill_no: "TI3565", total: 1890, bill_date: "2026-09-21" };
const stationery = { description: "Office stationery", vendor: "Trisha Books", bill_no: "127", total: 660, bill_date: "2026-08-30", vat_bill: false };

type Outcome = Awaited<ReturnType<typeof tool.run>>;
const rows = (outcome: Outcome) =>
  outcome.status === "ready" ? Object.fromEntries(outcome.draft.rows.map((row) => [row.label, row.value])) : {};
const formValues = (outcome: Outcome) => (outcome.status === "needs_input" ? outcome.form.values : {});

beforeEach(() => {
  saved.batches.length = 0;
  saved.error = null;
});

describe("add_company_bills", () => {
  it("is for administrators, like the Add VAT bill form", () => {
    expect(tool.permission).toBe("admin");
  });

  it("prepares a pasted list on one confirmation", async () => {
    const outcome = await tool.run({ bills: [lunch, coffee, stationery] }, context());
    expect(outcome.status).toBe("ready");
    expect(rows(outcome)).toEqual({
      "1 · Malaya Cafe & Restaurant #189": "NPR 1,040 · VAT 120 · 12 Aug 2026",
      "2 · Origin Coffee Pvt. Ltd. #TI3565": "NPR 1,890 · VAT 217.43 (13%) · 21 Sep 2026",
      "3 · Trisha Books #127": "NPR 660 · no VAT · 30 Aug 2026",
      Total: "3 bills · NPR 3,590 · VAT 337.43",
    });
    if (outcome.status === "ready") {
      expect(outcome.draft.confirmLabel).toBe("Save 3 bills");
      expect(outcome.draft.warnings).toEqual([]);
    }
  });

  it("saves exactly what was confirmed, with the VAT worked out", async () => {
    const outcome = await tool.run({ bills: [coffee, stationery] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    const result = await tool.execute(outcome.draft.args, context());
    expect(result).toMatchObject({ ok: true });
    expect(saved.batches[0]).toEqual([
      {
        description: "Coffee meeting",
        vendor_name: "Origin Coffee Pvt. Ltd.",
        bill_number: "TI3565",
        bill_date: "2026-09-21",
        total_amount: 1890,
        vat_amount: 217.43,
        paid_by: null,
        note: null,
        reimburse: false,
      },
      {
        description: "Office stationery",
        vendor_name: "Trisha Books",
        bill_number: "127",
        bill_date: "2026-08-30",
        total_amount: 660,
        vat_amount: 0,
        paid_by: null,
        note: null,
        reimburse: false,
      },
    ]);
  });

  it("dates a bill with no date today, as the form does, and says so", async () => {
    const undated = { description: "Team coffee", vendor: "Himalayan SIP", bill_no: "1698", total: 2049.97, vat_amount: 235.83 };
    const outcome = await tool.run({ bills: [lunch, undated] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    expect(rows(outcome)["2 · Himalayan SIP #1698"]).toBe("NPR 2,049.97 · VAT 235.83 · 16 Oct 2026 (today)");
    expect(outcome.draft.confirmLabel).toBe("Save 2 bills");
    expect(outcome.draft.warnings).toEqual([
      "Bill 2 · Himalayan SIP #1698 had no date, so it is dated today, 16 Oct 2026. Use Change something if it is from another day.",
    ]);
    await tool.execute(outcome.draft.args, context());
    expect(saved.batches[0]).toHaveLength(2);
    expect((saved.batches[0][1] as { bill_date: string }).bill_date).toBe(TODAY);
  });

  it("lists a bill missing its total but does not save it", async () => {
    const outcome = await tool.run({ bills: [lunch, { description: "Team coffee", bill_date: "2026-10-05" }] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    expect(rows(outcome)["2 · Team coffee"]).toBe("Not saved: needs the total");
    expect(outcome.draft.confirmLabel).toBe("Save 1 bill");
  });

  it("asks in a form when the only bill is missing something, and keeps the rest", async () => {
    const outcome = await tool.run({ bills: [{ description: "Team coffee", bill_date: "2026-10-05" }] }, context());
    expect(outcome.status).toBe("needs_input");
    if (outcome.status !== "needs_input") return;
    expect(outcome.form.fields.find((field) => field.name === "f_total")?.error).toBe("Enter the bill total.");
    const next = await tool.run(
      { ...outcome.form.values, f_description: "Team coffee", f_total: "2049.97", f_bill_date: "2026-10-05", f_vat: "yes" },
      context()
    );
    expect(rows(next)["1 · Team coffee"]).toBe("NPR 2,049.97 · VAT 235.84 (13%) · 5 Oct 2026");
  });

  it("marks a bill to be paid back only when asked", async () => {
    const outcome = await tool.run({ bills: [{ ...lunch, reimburse: true }, coffee] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    expect(rows(outcome)["1 · Malaya Cafe & Restaurant #189"]).toBe("NPR 1,040 · VAT 120 · 12 Aug 2026 · pay back");
    await tool.execute(outcome.draft.args, context());
    expect((saved.batches[0] as { reimburse: boolean }[]).map((bill) => bill.reimburse)).toEqual([true, false]);
  });

  it("refuses a date after today", async () => {
    const outcome = await tool.run({ bills: [{ ...lunch, bill_date: "2026-12-08" }] }, context());
    expect(outcome.status).toBe("needs_input");
    if (outcome.status === "needs_input") {
      expect(outcome.form.fields.find((field) => field.name === "f_bill_date")?.error).toBe("This date is after today. Check it.");
    }
  });

  it("warns about a bill already in VAT & bills, or repeated in the list", async () => {
    const summit = { description: "Company incorporation", vendor: "Summit Legal Advisory", bill_no: "009", total: 20340, bill_date: "2026-09-22", vat_amount: 2340 };
    const outcome = await tool.run({ bills: [summit, lunch, lunch] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    expect(outcome.draft.warnings).toEqual([
      "Bill 1 · Summit Legal Advisory #009 looks already added: Summit Legal Advisory, 22 Sep 2026, NPR 20,340.",
      "Bills 2 and 3 look like the same bill.",
    ]);
  });

  it("flags a printed VAT that is not 13% of the total", async () => {
    const outcome = await tool.run({ bills: [{ ...lunch, vat_amount: 500 }] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    expect(outcome.draft.warnings).toEqual(["Bill 1: VAT 500 is not 13% of NPR 1,040 (that would be 119.65). Check it."]);
  });

  it("'Change something' picks a bill, then changes or drops it", async () => {
    const first = await tool.run({ bills: [lunch, coffee, stationery] }, context());
    if (first.status !== "ready") throw new Error("expected a draft");

    const pick = await tool.run({ ...first.draft.args, _edit: true }, context());
    expect(pick.status).toBe("needs_input");
    if (pick.status !== "needs_input") return;
    expect(pick.form.fields.map((field) => field.name)).toEqual(["edit_index", "edit_action"]);

    const dropped = await tool.run({ ...pick.form.values, edit_index: "1", edit_action: "remove" }, context());
    expect(Object.keys(rows(dropped))).toEqual(["1 · Malaya Cafe & Restaurant #189", "2 · Trisha Books #127", "Total"]);

    const billForm = await tool.run({ ...pick.form.values, edit_index: "0", edit_action: "change" }, context());
    expect(formValues(billForm)).toMatchObject({ _stage: "bill", edit_index: "0" });
    const changed = await tool.run(
      { ...formValues(billForm), f_description: "Team lunch", f_vendor: "Malaya Cafe", f_bill_no: "189", f_total: "1040", f_bill_date: "2026-08-12", f_vat: "no" },
      context()
    );
    expect(rows(changed)["1 · Malaya Cafe #189"]).toBe("NPR 1,040 · no VAT · 12 Aug 2026");
  });

  it("reports the save action's error and says nothing was added", async () => {
    saved.error = "Bill 1: Enter the bill total.";
    const outcome = await tool.run({ bills: [lunch] }, context());
    if (outcome.status !== "ready") throw new Error("expected a draft");
    expect(await tool.execute(outcome.draft.args, context())).toEqual({ ok: false, error: "Bill 1: Enter the bill total." });
  });

  it("caps a batch at 20 bills", async () => {
    const outcome = await tool.run({ bills: Array.from({ length: 21 }, () => lunch) }, context());
    expect(outcome).toMatchObject({ status: "error" });
  });
});
