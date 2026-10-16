import { describe, expect, it } from "vitest";
import { summarizeBills } from "./funds";
import type { CompanyBill, MoneyTransfer } from "./types";

const bill = (id: string, total: number, reimburse: boolean) =>
  ({ id, description: "Bill", total_amount: total, vat_amount: 0, bill_date: "2026-09-01", reimburse }) as unknown as CompanyBill;
const payBack = (billId: string, amount: number) =>
  ({ id: `t-${billId}`, kind: "reimbursement", bill_id: billId, from_amount: amount }) as unknown as MoneyTransfer;

describe("summarizeBills", () => {
  it("owes nothing on a bill kept only for the books", () => {
    const [status] = summarizeBills([bill("cafe", 1040, false)], []);
    expect(status).toMatchObject({ pending: 0, paysBack: false, reimbursed: 0 });
  });

  it("owes the rest of a bill marked to be paid back", () => {
    const [status] = summarizeBills([bill("lawyer", 20340, true)], [payBack("lawyer", 5000)]);
    expect(status).toMatchObject({ pending: 15340, paysBack: true, reimbursed: 5000 });
  });

  it("still shows what was paid back on a bill that is no longer marked", () => {
    const [status] = summarizeBills([bill("old", 20340, false)], [payBack("old", 20340)]);
    expect(status).toMatchObject({ pending: 0, paysBack: true, reimbursed: 20340 });
  });
});
