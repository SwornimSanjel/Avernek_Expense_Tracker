import { describe, expect, it } from "vitest";
import { feeForPeriod, summarizeIncomeAgreement } from "@/lib/income";
import type { IncomeAgreement, IncomePayment, RecurringFeeChange } from "@/lib/types";

const TODAY = "2026-11-11";

/** An ads client launched on 5 Aug at Rs 35,000 a month (month 1 = setup). */
function client(changes: Partial<RecurringFeeChange>[] = []): IncomeAgreement {
  return {
    id: "ag-nc",
    client_name: "Nepal Comforts",
    service_type: "marketing",
    has_website: false,
    has_ads: true,
    has_automation: false,
    agreement_date: "2026-07-20",
    currency: "NPR",
    setup_amount: 50000,
    setup_payment_terms: "full_upfront",
    setup_advance_percent: 0,
    setup_due_date: "2026-08-05",
    setup_paid_in_full_date: null,
    website_amount: 0,
    ads_status: "live",
    automation_status: "not_started",
    recurring_billing_mode: "combined",
    recurring_amount: 35000,
    recurring_billing_start_date: "2026-08-05",
    setup_covers_first_cycle: true,
    recurring_due_days_before: 0,
    status: "active",
    service_end_date: null,
    recurring_fee_changes: changes.map((change) => ({
      stream: "combined",
      note: null,
      changed_on: TODAY,
      ...change,
    })),
  } as unknown as IncomeAgreement;
}

function monthlyPayment(period: string, amount: number): IncomePayment {
  return {
    id: `p-${period}`,
    agreement_id: "ag-nc",
    payment_for: "recurring",
    billing_period_start: period,
    billing_stream: "combined",
    amount,
    vat_amount: 0,
    tds_amount: 0,
    paid_on: period,
    created_at: `${period}T00:00:00.000Z`,
  } as unknown as IncomePayment;
}

function periods(summary: ReturnType<typeof summarizeIncomeAgreement>) {
  return summary.recurring.streams[0].periods;
}

describe("monthly fee changes", () => {
  it("uses the latest change that has started by each month", () => {
    const changes = [
      { stream: "combined", from: "2026-11-05", amount: 20000, note: null, changed_on: TODAY },
      { stream: "combined", from: "2027-03-05", amount: 25000, note: null, changed_on: TODAY },
    ] as RecurringFeeChange[];
    expect(feeForPeriod(35000, changes, "2026-10-05")).toBe(35000);
    expect(feeForPeriod(35000, changes, "2026-11-05")).toBe(20000);
    expect(feeForPeriod(35000, changes, "2027-02-05")).toBe(20000);
    expect(feeForPeriod(35000, changes, "2027-03-05")).toBe(25000);
  });

  it("lowers the fee from the chosen month and leaves earlier months alone", () => {
    const summary = summarizeIncomeAgreement(
      client([{ from: "2026-11-05", amount: 20000 }]),
      [monthlyPayment("2026-09-05", 35000), monthlyPayment("2026-10-05", 35000)],
      TODAY
    );
    const byStart = new Map(periods(summary).map((period) => [period.periodStart, period]));
    expect(byStart.get("2026-09-05")?.agreed).toBe(35000);
    expect(byStart.get("2026-09-05")?.status).toBe("paid");
    expect(byStart.get("2026-10-05")?.agreed).toBe(35000);
    expect(byStart.get("2026-11-05")?.agreed).toBe(20000);
    expect(byStart.get("2026-11-05")?.remaining).toBe(20000);
    expect(byStart.get("2026-12-05")?.agreed).toBe(20000);
    // What is owed now is the new, lower fee — not 35,000.
    expect(summary.recurring.dueNow).toBe(20000);
    expect(summary.recurring.monthlyTotal).toBe(20000);
    expect(summary.recurring.streams[0].startingAmount).toBe(35000);
  });

  it("a 20,000 payment settles a month whose fee was lowered to 20,000", () => {
    const summary = summarizeIncomeAgreement(
      client([{ from: "2026-11-05", amount: 20000 }]),
      [
        monthlyPayment("2026-09-05", 35000),
        monthlyPayment("2026-10-05", 35000),
        monthlyPayment("2026-11-05", 20000),
      ],
      TODAY
    );
    const november = periods(summary).find((period) => period.periodStart === "2026-11-05");
    expect(november?.status).toBe("paid");
    expect(summary.recurring.dueNow).toBe(0);
    expect(summary.recurring.overdue).toBe(0);
  });

  it("shows a change that starts later as upcoming, keeping today's fee", () => {
    const summary = summarizeIncomeAgreement(client([{ from: "2026-12-05", amount: 20000 }]), [], TODAY);
    const stream = summary.recurring.streams[0];
    expect(stream.monthlyAmount).toBe(35000);
    expect(stream.nextFeeChange?.amount).toBe(20000);
    expect(stream.nextFeeChange?.from).toBe("2026-12-05");
  });

  it("ignores broken rows and works before the migration adds the column", () => {
    const broken = client([{ from: "not-a-date", amount: 1 }]);
    expect(summarizeIncomeAgreement(broken, [], TODAY).recurring.monthlyTotal).toBe(35000);
    const legacy = client();
    delete (legacy as Partial<IncomeAgreement>).recurring_fee_changes;
    expect(summarizeIncomeAgreement(legacy, [], TODAY).recurring.monthlyTotal).toBe(35000);
  });
});
