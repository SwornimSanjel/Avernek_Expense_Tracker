import { describe, expect, it } from "vitest";
import { bsMonthKey, bsMonthLabel, bsMonthRange, fiscalYearOf, formatBs, fromBs, returnDueDate, shiftBsMonth, toBs } from "./nepali-date";

// Checked against dates printed on real documents: the company certificate
// (2083 Shrawan 26 = 11 Aug 2026) and bills with both calendars on them.
describe("Nepali dates", () => {
  it("converts both ways", () => {
    expect(fromBs(2083, 4, 26)).toBe("2026-08-11");
    expect(fromBs(2083, 5, 28)).toBe("2026-09-13");
    expect(fromBs(2083, 6, 5)).toBe("2026-09-21");
    expect(toBs("2026-08-11")).toEqual({ year: 2083, month: 4, day: 26 });
    expect(formatBs("2026-09-22")).toBe("Ashwin 6, 2083");
  });

  it("knows each month's AD range", () => {
    expect(bsMonthKey("2026-10-16")).toBe("2083-06");
    expect(bsMonthLabel("2083-06")).toBe("Ashwin 2083");
    expect(bsMonthRange("2083-05")).toEqual({ from: "2026-08-17", to: "2026-09-16" });
    expect(shiftBsMonth("2083-12", 1)).toBe("2084-01");
  });

  it("puts a month's VAT and TDS due on the 25th of the next month", () => {
    expect(formatBs(returnDueDate("2083-06"))).toBe("Kartik 25, 2083");
    expect(returnDueDate("2083-06")).toBe("2026-11-11");
  });

  it("starts the fiscal year on Shrawan 1", () => {
    expect(fiscalYearOf("2026-07-17")).toEqual({ label: "2083/84", start: 2083 });
    expect(fiscalYearOf("2026-07-16")).toEqual({ label: "2082/83", start: 2082 });
  });
});
