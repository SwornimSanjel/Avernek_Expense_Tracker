import { describe, expect, it } from "vitest";
import type { BillStatus } from "@/lib/funds";
import type { CompanyBill } from "@/lib/types";
import type { RequestData } from "../data";
import { listCompanyBills } from "./bills";
import type { ToolContext } from "./types";

const TODAY = "2026-10-16";

function status(id: string, vendor: string, no: string, date: string, total: number, vat: number, reimbursed = 0, reimburse = false, claim = false): BillStatus {
  const bill = {
    id,
    description: "Team food",
    vendor_name: vendor,
    bill_number: no,
    bill_date: date,
    total_amount: total,
    vat_amount: vat,
    paid_by: null,
    note: null,
    reimburse,
    claim_vat: claim,
  } as unknown as CompanyBill;
  const paysBack = reimburse || reimbursed > 0;
  return { bill, reimbursed, pending: paysBack ? total - reimbursed : 0, paysBack, reimbursements: [] };
}

const billStatuses = [
  status("b1", "Origin Coffee", "TI3565", "2026-09-21", 1890, 217.43, 0, true, true),
  status("b2", "Achaar Ghar", "2035", "2026-09-13", 1480, 170.26, 1480),
  status("b3", "Malaya Cafe", "189", "2026-08-12", 1040, 120),
  status("b4", "Trisha Books", "127", "2026-08-30", 660, 0),
];

function context(): ToolContext {
  const data = { today: TODAY, ledger: async () => ({ billStatuses }) } as unknown as RequestData;
  return { session: { sub: "u", email: "a@b.c", name: "A", isAdmin: false, exp: 0 }, today: TODAY, data };
}

type Table = { type: "table"; title: string; rows: Record<string, string>[]; footer?: Record<string, string> };
const tables = (cards: unknown[]) => cards.filter((card): card is Table => (card as Table).type === "table");

describe("list_company_bills", () => {
  it("groups bills by month, newest first, with each month's totals", async () => {
    const outcome = await listCompanyBills.run({}, context());
    if (outcome.status !== "ok") throw new Error("expected ok");
    const months = tables(outcome.cards);
    expect(months.map((card) => card.title)).toEqual(["September 2026 · 2 bills", "August 2026 · 2 bills"]);
    expect(months[1].rows.map((row) => row.date)).toEqual(["30 Aug", "12 Aug"]);
    expect(months[0].rows[1].bill).toBe("Achaar Ghar #2035 · paid back");
    expect(months[1].footer).toEqual({ date: "Total", bill: "", total: "1,700", vat: "120" });
    expect(months[0].rows[0].bill).toBe("Origin Coffee #TI3565 · to pay back");
    expect(months[0].rows[0].vat).toBe("217.43 claimed");
    expect(months[0].rows[1].vat).toBe("170.26");
    expect(outcome.summary).toBe("4 bills in total: NPR 5,070 with VAT 507.69, of which 217.43 claimed; NPR 1,890 still to reimburse.");
  });

  it("narrows to a period, a shop and unpaid bills", async () => {
    const august = await listCompanyBills.run({ from: "2026-08-01", to: "2026-08-31" }, context());
    if (august.status !== "ok") throw new Error("expected ok");
    expect(tables(august.cards).map((card) => card.title)).toEqual(["August 2026 · 2 bills"]);

    const shop = await listCompanyBills.run({ search: "malaya" }, context());
    if (shop.status !== "ok") throw new Error("expected ok");
    expect(tables(shop.cards)[0].rows.map((row) => row.bill)).toEqual(["Malaya Cafe #189"]);

    const unpaid = await listCompanyBills.run({ only_unpaid: true, from: "2026-09-01", to: "2026-09-30" }, context());
    if (unpaid.status !== "ok") throw new Error("expected ok");
    expect(tables(unpaid.cards)[0].rows.map((row) => row.bill)).toEqual(["Origin Coffee #TI3565 · to pay back"]);
  });

  it("says so when nothing matches", async () => {
    const outcome = await listCompanyBills.run({ from: "2026-01-01", to: "2026-01-31" }, context());
    expect(outcome).toMatchObject({ status: "ok", summary: "No bills in Avernek's name between 1 Jan 2026 and 31 Jan 2026." });
  });
});
