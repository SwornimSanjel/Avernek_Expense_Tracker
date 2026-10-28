import { describe, expect, it } from "vitest";
import { summarizeIncomeAgreement } from "@/lib/income";
import { csvMoney, csvResponse, fileSlug } from "@/lib/csv";
import type { IncomeAgreement, IncomePayment } from "@/lib/types";

const TODAY = "2026-10-27";

function agreement(overrides: Partial<IncomeAgreement>): IncomeAgreement {
  return {
    id: "ag-1",
    client_name: "Kalika Technical",
    agreement_name: null,
    service_type: "website",
    has_website: true,
    has_ads: false,
    has_automation: false,
    agreement_date: "2026-08-01",
    currency: "NPR",
    setup_amount: 0,
    setup_payment_terms: "full_upfront",
    setup_advance_percent: 0,
    setup_due_date: null,
    setup_paid_in_full_date: null,
    website_amount: 80000,
    website_due_date: "2026-09-20",
    website_paid_in_full_date: null,
    ads_status: "not_started",
    automation_status: "not_started",
    recurring_billing_mode: "combined",
    recurring_amount: 0,
    recurring_billing_start_date: null,
    setup_covers_first_cycle: false,
    recurring_due_days_before: 0,
    status: "active",
    service_end_date: null,
    ...overrides,
  } as unknown as IncomeAgreement;
}

function payment(overrides: Partial<IncomePayment>): IncomePayment {
  return {
    id: "p-1",
    agreement_id: "ag-1",
    payment_for: "website",
    billing_period_start: null,
    billing_stream: null,
    amount: 30000,
    vat_amount: 0,
    tds_amount: 0,
    paid_on: "2026-09-25",
    created_at: "2026-09-25T00:00:00.000Z",
    ...overrides,
  } as unknown as IncomePayment;
}

describe("churned clients", () => {
  it("an active client's unpaid website balance is overdue", () => {
    const summary = summarizeIncomeAgreement(agreement({}), [payment({})], TODAY);
    expect(summary.totalOverdue).toBe(50000);
    expect(summary.overallStatus).toBe("overdue");
    expect(summary.churned).toBe(false);
    expect(summary.unpaidWhenLeft).toBe(0);
  });

  it("a churned client owes nothing due or overdue, and keeps what they paid", () => {
    const summary = summarizeIncomeAgreement(
      agreement({ status: "churned", service_end_date: "2026-10-01" }),
      [payment({})],
      TODAY
    );
    expect(summary.churned).toBe(true);
    expect(summary.totalCollected).toBe(30000);
    expect(summary.totalDueNow).toBe(0);
    expect(summary.totalOverdue).toBe(0);
    expect(summary.outstanding).toBe(0);
    expect(summary.nextDueDate).toBeNull();
    expect(summary.unpaidWhenLeft).toBe(50000);
    expect(summary.overallStatus).toBe("unpaid");
    expect(summary.website?.status).toBe("partial");
    // The balance stays on the bucket so a late payment can still be recorded.
    expect(summary.website?.remaining).toBe(50000);
  });

  it("no monthly cycle of a churned client is overdue", () => {
    const monthly = agreement({
      status: "churned",
      has_website: false,
      has_ads: true,
      service_type: "marketing",
      website_amount: 0,
      recurring_amount: 10000,
      recurring_billing_start_date: "2026-06-01",
      service_end_date: "2026-09-15",
    });
    const summary = summarizeIncomeAgreement(monthly, [], TODAY);
    const periods = summary.recurring.streams.flatMap((stream) => stream.periods);
    expect(periods.length).toBeGreaterThan(0);
    expect(periods.some((period) => period.status === "overdue")).toBe(false);
    expect(summary.recurring.dueNow).toBe(0);
    expect(summary.recurring.overdue).toBe(0);
    expect(summary.unpaidWhenLeft).toBeGreaterThan(0);
  });
});

describe("csv", () => {
  it("quotes only cells that need it, adds a BOM and Windows line endings", async () => {
    const response = csvResponse("x.csv", ["Date", "Note"], [["2026-10-01", 'Lunch, "team"'], ["2026-10-02", null]]);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // UTF-8 byte-order mark, so Excel reads the file as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('Date,Note\r\n2026-10-01,"Lunch, ""team"""\r\n2026-10-02,\r\n');
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="x.csv"');
  });

  it("writes money with two decimals and makes readable file names", () => {
    expect(csvMoney("1500")).toBe("1500.00");
    expect(csvMoney(null)).toBe("");
    expect(fileSlug("October 2026")).toBe("october-2026");
    expect(fileSlug("2026-01-01 → 2026-03-31")).toBe("2026-01-01-to-2026-03-31");
    expect(fileSlug("All time")).toBe("all-time");
  });
});
