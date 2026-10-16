import { describe, expect, it } from "vitest";
import { daysUntil, firstTaxMonth, tdsPeriods, upcomingDeadlines, vatPeriods } from "./tax-calendar";
import type { CompanyBill, IncomePayment, TaxPayment } from "./types";

const TODAY = "2026-10-16"; // Ashwin 30, 2083

// Avernek's books as they stand: one client receipt with VAT (Hotel The
// President, 9 Oct = Ashwin), the lawyer's VAT bill (claimed) and a cafe bill
// whose VAT is paid but not claimable.
const payments = [{ paid_on: "2026-10-09", vat_amount: 4550, tds_amount: 0 }] as unknown as IncomePayment[];
const bills = [
  { bill_date: "2026-09-22", vat_amount: 2340, claim_vat: true },
  { bill_date: "2026-08-12", vat_amount: 120, claim_vat: false },
] as unknown as CompanyBill[];
const noTax: TaxPayment[] = [];

describe("VAT by Nepali month", () => {
  const start = firstTaxMonth({ payments, otherIncome: [], bills, taxPayments: noTax, today: TODAY });

  it("starts at the first month with a record", () => {
    expect(start).toBe("2083-04"); // the cafe bill, 12 Aug = Shrawan 27
  });

  it("works out each month's return, due on the 25th of the next month", () => {
    const periods = vatPeriods({ payments, otherIncome: [], bills, taxPayments: noTax, startKey: start, today: TODAY });
    expect(periods.map((p) => [p.label, p.collected, p.deductible, p.payable, p.due, p.status])).toEqual([
      ["Shrawan 2083", 0, 0, 0, "2026-09-10", "late"],
      ["Bhadra 2083", 0, 0, 0, "2026-10-11", "late"],
      ["Ashwin 2083", 4550, 2340, 2210, "2026-11-11", "open"],
    ]);
  });

  it("marks a month done once its return is recorded, nil returns included", () => {
    const filed = [
      { tax_type: "vat", period_key: "2083-04", amount: 0 },
      { tax_type: "vat", period_key: "2083-05", amount: 0 },
    ] as unknown as TaxPayment[];
    const periods = vatPeriods({ payments, otherIncome: [], bills, taxPayments: filed, startKey: start, today: TODAY });
    expect(periods.map((p) => p.status)).toEqual(["filed", "filed", "open"]);
  });

  it("carries a month's extra claimable VAT into the next", () => {
    const periods = vatPeriods({
      payments: [{ paid_on: "2026-10-09", vat_amount: 1000 }] as unknown as IncomePayment[],
      otherIncome: [],
      bills: [{ bill_date: "2026-09-01", vat_amount: 1500, claim_vat: true }] as unknown as CompanyBill[],
      taxPayments: noTax,
      startKey: "2083-05",
      today: TODAY,
    });
    expect(periods.map((p) => [p.label, p.payable, p.carriedIn])).toEqual([
      ["Bhadra 2083", 0, 0],
      ["Ashwin 2083", 0, 1500],
    ]);
  });
});

describe("TDS by Nepali month", () => {
  it("flags months with salaries until their TDS is deposited", () => {
    const periods = tdsPeriods({
      payments: [],
      otherIncome: [],
      salaries: [
        { date: "2026-10-13", amount: 10000 },
        { date: "2026-10-14", amount: 10000 },
      ],
      taxPayments: noTax,
      startKey: "2083-05",
      today: "2026-10-20", // Kartik 3: Ashwin has ended
    });
    expect(periods.map((p) => [p.label, p.salaries, p.status])).toEqual([
      ["Bhadra 2083", 0, "none"],
      ["Ashwin 2083", 20000, "due"],
      ["Kartik 2083", 0, "none"],
    ]);
  });
});

describe("deadlines", () => {
  it("lists late returns first, then the next VAT, advance tax and annual return", () => {
    const vat = vatPeriods({ payments, otherIncome: [], bills, taxPayments: noTax, startKey: "2083-04", today: TODAY });
    const list = upcomingDeadlines({ vat, tds: [], startKey: "2083-04", today: TODAY });
    expect(list.map((d) => [d.title, d.dueBs, d.late])).toEqual([
      ["VAT return · Shrawan 2083", "Bhadra 25, 2083", true],
      ["VAT return · Bhadra 2083", "Ashwin 25, 2083", true],
      ["VAT return · Ashwin 2083", "Kartik 25, 2083", false],
      ["Advance income tax · 40% · FY 2083/84", "Poush 30, 2083", false],
      ["Advance income tax · 70% · FY 2083/84", "Chaitra 30, 2083", false],
      ["Advance income tax · 100% · FY 2083/84", "Ashadh 31, 2084", false],
      ["Income tax return · FY 2083/84", "Ashwin 30, 2084", false],
    ]);
  });

  it("counts days to a deadline", () => {
    expect(daysUntil("2026-11-11", TODAY)).toBe(26);
    expect(daysUntil("2026-10-11", TODAY)).toBe(-5);
  });
});
