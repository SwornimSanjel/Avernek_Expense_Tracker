import { describe, expect, it } from "vitest";
import { fromPaisa, multiplyToPaisa, sumMoney, sumPaisa, toPaisa } from "./money";

describe("toPaisa", () => {
  it("reads Postgres numeric strings exactly", () => {
    expect(toPaisa("1234.50")).toBe(123450);
    expect(toPaisa("0.01")).toBe(1);
    expect(toPaisa("35000")).toBe(3500000);
    expect(toPaisa("-12.34")).toBe(-1234);
    expect(toPaisa(".5")).toBe(50);
  });

  it("reads form numbers, rounding half a paisa away from zero", () => {
    expect(toPaisa(1.005)).toBe(101);
    expect(toPaisa(-1.005)).toBe(-101);
    expect(toPaisa(0.1)).toBe(10);
    expect(toPaisa(2500)).toBe(250000);
  });

  it("treats null, undefined and blank as zero", () => {
    expect(toPaisa(null)).toBe(0);
    expect(toPaisa(undefined)).toBe(0);
    expect(toPaisa("  ")).toBe(0);
  });

  it("refuses values that are not amounts", () => {
    expect(() => toPaisa("12,000")).toThrow();
    expect(() => toPaisa("abc")).toThrow();
    expect(() => toPaisa(Number.NaN)).toThrow();
    expect(() => toPaisa(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("sums", () => {
  it("adds exactly where floats drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(["0.10", "0.20", null, "1.05"])).toBe(1.35);
  });

  it("stays exact over many small amounts", () => {
    const amounts = Array.from({ length: 10_000 }, () => "0.07");
    expect(sumPaisa(amounts)).toBe(70_000);
    expect(fromPaisa(sumPaisa(amounts))).toBe(700);
  });

  it("converts at a rate, rounding once", () => {
    expect(multiplyToPaisa(20, 152.83)).toBe(305660);
    expect(multiplyToPaisa("12.99", 133.3333)).toBe(Math.round(1299 * 133.3333));
  });
});
