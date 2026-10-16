import { describe, expect, it } from "vitest";
import { BULK_LIMIT, bulkIds, bulkResult } from "./bulk";

const ID = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

describe("bulkIds", () => {
  it("keeps record ids only, once each", () => {
    expect(bulkIds([ID, ID.toUpperCase(), "1; drop table expenses", 42, null])).toEqual([ID, ID.toUpperCase()]);
    expect(bulkIds([ID, ID])).toEqual([ID]);
    expect(bulkIds("not a list")).toEqual([]);
  });

  it("caps one action", () => {
    const many = Array.from({ length: BULK_LIMIT + 5 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(bulkIds(many)).toHaveLength(BULK_LIMIT);
  });
});

describe("bulkResult", () => {
  const noun = { one: "bill", many: "bills" };
  it("says how many were deleted", () => {
    expect(bulkResult(12, 12, noun)).toEqual({ deleted: 12, skipped: 0, message: "Deleted 12 bills." });
    expect(bulkResult(1, 1, noun).message).toBe("Deleted 1 bill.");
  });

  it("says how many were kept, and why", () => {
    expect(bulkResult(11, 12, noun, "it has been paid back").message).toBe("Deleted 11 bills. 1 was not deleted: it has been paid back.");
  });
});
