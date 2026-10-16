import { describe, expect, it } from "vitest";
import { claimedVat, computeTaxPosition, summarizeBills } from "./funds";
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

describe("VAT claimed on bills", () => {
  const vatBill = (vat: number, claim: boolean) => ({ vat_amount: vat, claim_vat: claim }) as unknown as CompanyBill;

  it("counts only the VAT marked to claim", () => {
    expect(claimedVat(vatBill(2340, true))).toBe(2340);
    expect(claimedVat(vatBill(120, false))).toBe(0);
  });

  it("takes only claimed VAT off what is owed to IRD", () => {
    const payments = [{ vat_amount: 4550, tds_amount: 0 }] as unknown as Parameters<typeof computeTaxPosition>[0]["payments"];
    const tax = computeTaxPosition({ payments, bills: [vatBill(2340, true), vatBill(120, false), vatBill(235.83, false)] });
    expect(tax).toMatchObject({ outputVat: 4550, inputVat: 2340, vatOwed: 2210 });
  });
});
