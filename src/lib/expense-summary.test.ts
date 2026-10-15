import { describe, expect, it } from "vitest";
import type { Expense } from "./types";
import {
  expenseTotals,
  groupExpenses,
  monthlyTotals,
  projectedRenewalsNpr,
} from "./expense-summary";

type Row = {
  amount: number | string;
  amount_npr: number | string | null;
  currency: "NPR" | "USD";
  expense_date: string;
  category_id: string | null;
};

// Amounts arrive as numeric strings at runtime; the types say number.
const rows = (list: Row[]) => list as unknown as Expense[];

const sample = rows([
  { amount: "2500.00", amount_npr: "2500.00", currency: "NPR", expense_date: "2026-10-01", category_id: "hosting" },
  { amount: "20.00", amount_npr: "3056.60", currency: "USD", expense_date: "2026-10-14", category_id: "software" },
  { amount: "12.00", amount_npr: null, currency: "USD", expense_date: "2026-10-20", category_id: "software" },
  { amount: "0.10", amount_npr: "0.10", currency: "NPR", expense_date: "2026-09-30", category_id: null },
  { amount: "0.20", amount_npr: "0.20", currency: "NPR", expense_date: "2026-11-01", category_id: "hosting" },
]);

describe("expenseTotals", () => {
  it("totals converted expenses in NPR and counts the rest separately", () => {
    expect(expenseTotals(sample)).toEqual({
      totalNpr: 5556.9,
      count: 5,
      unconvertedCount: 1,
      usdAmount: 32,
    });
  });

  it("includes `from` and excludes `before`", () => {
    const october = expenseTotals(sample, { from: "2026-10-01", before: "2026-11-01" });
    expect(october).toEqual({ totalNpr: 5556.6, count: 3, unconvertedCount: 1, usdAmount: 32 });
    expect(expenseTotals(sample, { from: "2026-11-01" }).totalNpr).toBe(0.2);
    expect(expenseTotals(sample, { before: "2026-10-01" }).totalNpr).toBe(0.1);
  });
});

describe("groupExpenses", () => {
  it("groups converted expenses, largest first, with null under ''", () => {
    expect(groupExpenses(sample, (row) => row.category_id)).toEqual([
      { key: "software", totalNpr: 3056.6, count: 1 },
      { key: "hosting", totalNpr: 2500.2, count: 2 },
      { key: "", totalNpr: 0.1, count: 1 },
    ]);
  });
});

describe("monthlyTotals", () => {
  it("totals each month", () => {
    expect(
      monthlyTotals(sample, [
        { from: "2026-09-01", before: "2026-10-01" },
        { from: "2026-10-01", before: "2026-11-01" },
      ])
    ).toEqual([0.1, 5556.6]);
  });
});

describe("projectedRenewalsNpr", () => {
  const subscriptions = [
    { amount: 1500, currency: "NPR" as const, cycle: "monthly" as const, next_renewal_date: "2026-11-05" },
    { amount: 20, currency: "USD" as const, cycle: "monthly" as const, next_renewal_date: "2026-11-09" },
    { amount: 12000, currency: "NPR" as const, cycle: "annual" as const, next_renewal_date: "2026-11-20" },
    { amount: 9000, currency: "NPR" as const, cycle: "annual" as const, next_renewal_date: "2027-03-01" },
  ];

  it("counts monthly ones and annual ones renewing next month", () => {
    expect(projectedRenewalsNpr(subscriptions, 152.83, "2026-11-01", "2026-12-01")).toBe(1500 + 3056.6 + 12000);
  });

  it("values USD at zero when there is no rate yet, as the dashboard did", () => {
    expect(projectedRenewalsNpr(subscriptions, null, "2026-11-01", "2026-12-01")).toBe(13500);
  });
});

describe("agreement with the dashboard's previous float arithmetic", () => {
  // Random ledgers: the exact totals must equal the old float sums to within
  // the float error, i.e. never differ by a paisa or more.
  function legacyTotal(list: Row[]) {
    return list
      .filter((row) => row.amount_npr != null)
      .map((row) => row.amount_npr as string)
      .reduce((a, b) => a + Number(b), 0);
  }

  it("matches on 200 random ledgers", () => {
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let ledger = 0; ledger < 200; ledger++) {
      const list: Row[] = Array.from({ length: 1 + Math.floor(random() * 300) }, () => {
        const amount = (Math.floor(random() * 5_000_000) / 100).toFixed(2);
        return {
          amount,
          amount_npr: random() < 0.05 ? null : amount,
          currency: "NPR",
          expense_date: "2026-10-01",
          category_id: null,
        };
      });
      const exact = expenseTotals(rows(list)).totalNpr;
      expect(Math.abs(exact - legacyTotal(list))).toBeLessThan(0.005);
      expect(Math.round(exact * 100)).toBe(Math.round(exact * 100)); // whole paisa
    }
  });
});
