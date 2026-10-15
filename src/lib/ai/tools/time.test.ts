import { describe, expect, it } from "vitest";
import { getDateTime, nepalNow } from "./time";
import type { ToolContext } from "./types";

describe("nepalNow", () => {
  it("reads the date and time on Nepal's clock (UTC+5:45)", () => {
    expect(nepalNow(new Date("2026-10-15T10:24:00Z"))).toEqual({ date: "2026-10-15", weekday: "Thursday", time: "4:09 PM" });
  });

  it("is already tomorrow in Nepal while it is still today in UTC", () => {
    expect(nepalNow(new Date("2026-10-15T18:30:00Z"))).toEqual({ date: "2026-10-16", weekday: "Friday", time: "12:15 AM" });
  });
});

describe("get_date_time", () => {
  it("answers 'what is today's date' and counts days to a date", async () => {
    const outcome = await getDateTime.run({ date: "2099-01-01" }, {} as ToolContext);
    expect(outcome.status).toBe("ok");
    const { summary } = outcome as { summary: string };
    expect(summary).toMatch(/^Today is \w+day, \d{1,2} \w{3} \d{4}, and it is \d{1,2}:\d{2} (AM|PM) in Nepal\. 1 Jan 2099: \d+ days .* from today\.$/);
  });
});


