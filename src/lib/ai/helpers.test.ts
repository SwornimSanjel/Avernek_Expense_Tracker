import { describe, expect, it } from "vitest";
import { addDays, daysBetween, durationLabel, formatDate, monthBounds } from "./dates";
import { matchOne, normalizeName } from "./match";

describe("dates", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts whole days", () => {
    expect(daysBetween("2026-10-01", "2026-10-15")).toBe(14);
    expect(daysBetween("2026-10-15", "2026-10-01")).toBe(-14);
    expect(daysBetween("2025-10-15", "2026-10-15")).toBe(365);
  });

  it("describes durations", () => {
    expect(durationLabel(1)).toBe("1 day");
    expect(durationLabel(45)).toBe("45 days");
    expect(durationLabel(430)).toBe("430 days (about 1 year 2 months)");
    expect(durationLabel(-3)).toBe("in 3 days");
  });

  it("formats dates and months", () => {
    expect(formatDate("2026-10-14")).toBe("14 Oct 2026");
    expect(formatDate(null)).toBe("—");
    expect(monthBounds("2026-12-09")).toEqual({ from: "2026-12-01", before: "2027-01-01" });
  });
});

describe("name matching", () => {
  const clients = [
    { name: "Kalika Technical Pvt. Ltd." },
    { name: "Kalika Hardware" },
    { name: "Nepal Comfort" },
    { name: "Roshi Website" },
  ];
  const names = (client: { name: string }) => [client.name];

  it("normalises company names", () => {
    expect(normalizeName("Kalika Technical Pvt. Ltd.")).toBe("kalika technical");
    expect(normalizeName("  NEPAL-Comfort ")).toBe("nepal comfort");
  });

  it("picks the one client a name fits", () => {
    expect(matchOne(clients, names, "kalika technical")).toEqual({ kind: "one", item: clients[0] });
    expect(matchOne(clients, names, "comfort")).toEqual({ kind: "one", item: clients[2] });
    expect(matchOne(clients, names, "kal tech")).toEqual({ kind: "one", item: clients[0] });
  });

  it("asks when a name fits several, and never guesses", () => {
    expect(matchOne(clients, names, "Kalika")).toEqual({ kind: "many", items: [clients[0], clients[1]] });
    expect(matchOne(clients, names, "Himalayan Traders")).toEqual({ kind: "none" });
    expect(matchOne(clients, names, "")).toEqual({ kind: "none" });
  });

  it("prefers an exact name over partial ones", () => {
    const list = [{ name: "Roshi" }, { name: "Roshi Website" }];
    expect(matchOne(list, names, "roshi")).toEqual({ kind: "one", item: list[0] });
  });
});
