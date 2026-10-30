import { describe, expect, it } from "vitest";
import {
  FULL_ACCESS,
  SECTIONS,
  canView,
  canViewExpenses,
  describeAccess,
  firstAllowedHref,
  hasEverything,
  ledgerOf,
  resolveAccess,
  storedAccess,
} from "@/lib/access";
import { expenseWhere, scopeCondition } from "@/lib/expense-filters";

const everyPage = SECTIONS.map((section) => section.key);

describe("resolveAccess", () => {
  it("gives administrators and unlimited people everything", () => {
    expect(resolveAccess({ is_admin: true, access: { sections: [], expenses: [] } })).toBe(FULL_ACCESS);
    expect(resolveAccess({ is_admin: false, access: null })).toBe(FULL_ACCESS);
  });

  it("keeps only known pages and expense kinds", () => {
    const access = resolveAccess({ is_admin: false, access: { sections: ["income", "nonsense"], expenses: ["vat", 7, "x"] } });
    expect(access).toEqual({ full: false, sections: ["income"], expenses: ["vat"] });
  });

  it("treats a malformed value as no access, not full access", () => {
    expect(resolveAccess({ is_admin: false, access: "garbage" })).toEqual({ full: false, sections: [], expenses: [] });
  });
});

describe("what a limited person can open", () => {
  const vatOnly = resolveAccess({ is_admin: false, access: { sections: everyPage, expenses: ["vat"] } });

  it("shows only VAT-account expenses and hides pages that add up every account", () => {
    expect(canViewExpenses(vatOnly)).toBe(true);
    expect(canView(vatOnly, "income")).toBe(true);
    expect(canView(vatOnly, "loans")).toBe(true);
    for (const key of ["overview", "statement", "funds", "subscriptions", "vat", "bills", "clients", "settlements"] as const) {
      expect(canView(vatOnly, key)).toBe(false);
    }
    expect(hasEverything(vatOnly)).toBe(false);
    expect(firstAllowedHref(vatOnly)).toBe("/expenses");
  });

  it("with every expense kind, the ticked pages open", () => {
    const all = resolveAccess({ is_admin: false, access: { sections: ["overview", "clients"], expenses: ["vat", "non_vat", "founder"] } });
    expect(canView(all, "overview")).toBe(true);
    expect(canView(all, "clients")).toBe(true);
    expect(canView(all, "income")).toBe(false);
    expect(firstAllowedHref(all)).toBe("/");
    expect(hasEverything(all)).toBe(false);
  });

  it("with nothing ticked, only Settings is left", () => {
    const none = resolveAccess({ is_admin: false, access: { sections: [], expenses: [] } });
    expect(canViewExpenses(none)).toBe(false);
    expect(firstAllowedHref(none)).toBe("/settings");
    expect(describeAccess(none)).toBe("Nothing yet");
  });

  it("stores everything ticked as null, the same as never limited", () => {
    expect(storedAccess(everyPage, ["vat", "non_vat", "founder"])).toBeNull();
    expect(storedAccess(["income"], ["vat"])).toEqual({ sections: ["income"], expenses: ["vat"] });
  });
});

describe("ledgerOf", () => {
  const vat = new Set(["acc-vat"]);
  it("sorts an expense by where the money came from", () => {
    expect(ledgerOf({ funding_source: "personal", money_account_id: null }, vat)).toBe("founder");
    expect(ledgerOf({ funding_source: "company_funds", money_account_id: "acc-vat" }, vat)).toBe("vat");
    expect(ledgerOf({ funding_source: "company_funds", money_account_id: "acc-custody" }, vat)).toBe("non_vat");
  });
});

describe("expense scope in SQL", () => {
  const push = (params: unknown[]) => (value: unknown) => `$${params.push(value)}`;

  it("adds nothing for every kind", () => {
    expect(scopeCondition({ ledgers: ["vat", "non_vat", "founder"], vatAccountIds: ["a"] }, push([]))).toBeNull();
    expect(scopeCondition(undefined, push([]))).toBeNull();
  });

  it("matches nothing for no kind", () => {
    expect(scopeCondition({ ledgers: [], vatAccountIds: ["a"] }, push([]))).toBe("false");
  });

  it("limits to the VAT accounts", () => {
    const params: unknown[] = [];
    const sql = scopeCondition({ ledgers: ["vat"], vatAccountIds: ["a"] }, push(params));
    expect(sql).toBe("((e.funding_source = 'company_funds' and e.money_account_id = any($1::uuid[])))");
    expect(params).toEqual([["a"]]);
  });

  it("puts the scope first in the WHERE clause, before the filters", () => {
    const { where, params } = expenseWhere({ period: "all", cat: "c1" }, [], "2026-10-30", { ledgers: ["non_vat", "founder"], vatAccountIds: ["a"] });
    expect(where).toBe(
      "where (e.funding_source <> 'company_funds' or (e.funding_source = 'company_funds' and not coalesce(e.money_account_id = any($1::uuid[]), false))) and e.category_id = $2"
    );
    expect(params).toEqual([["a"], "c1"]);
  });
});
