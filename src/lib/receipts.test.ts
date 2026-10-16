import { describe, expect, it } from "vitest";
import { guessCategory, parseReceiptDate, parseReceiptText } from "./receipts";

// The text pdf.js returns for real receipts (emails replaced). NUL is how the
// receipts' en dash comes out.
const N = "\u0000";
const claudeSept = `Page 1 of 1 Receipt Invoice number LEBDNKOU${N}0004 Receipt number 2729${N}7850${N}5528 Date paid September 12, 2026 Anthropic, PBC @anthropic 548 Market Street PMB 90375 San Francisco, California 94104 United States support@anthropic.com Bill to Avernek Technologies Pvt. Ltd. Satdobato Lalitpur 44700 Nepal billing@example.com NP PAN 623683969 $20.00 paid on September 12, 2026 Description Qty Unit price Amount Claude Pro Sep 12${N}Oct 12, 2026 1 $20.00 $20.00 Subtotal $20.00 Total $20.00 Amount paid $20.00 Payment history Payment method Date Amount paid Receipt number Visa - 1503 September 12, 2026 $20.00 2729${N}7850${N} 5528`;
const claudeAug = `Page 1 of 1 Receipt Invoice number MQFON5QY${N}0004 Receipt number 2735${N}0214${N}0179 Date paid August 24, 2026 Anthropic, PBC @anthropic 548 Market Street PMB 90375 San Francisco, California 94104 United States support@anthropic.com Bill to someone@example.com's Organization Satdobato Lalitpur 44600 Nepal someone@example.com $20.00 paid on August 24, 2026 Description Qty Unit price Amount Claude Pro Aug 24${N}Sep 24, 2026 1 $20.00 $20.00 Subtotal $20.00 Total $20.00 Amount paid $20.00 Payment history Payment method Date Amount paid Receipt number Visa - 1503 August 24, 2026 $20.00 2735${N}0214${N} 0179`;
const claudeTrial = `Page 1 of 1 Invoice Invoice number MQFON5QY${N}0001 Date of issue August 11, 2026 Date due August 11, 2026 Anthropic, PBC @anthropic 548 Market Street Bill to someone@example.com's Organization Satdobato Lalitpur 44600 Nepal $0.00 USD due August 11, 2026 Description Qty Unit price Amount Trial period for Claude Pro Aug 11${N}Aug 18, 2026 1 $0.00 $0.00 Subtotal $0.00 Total $0.00 Amount due $0.00 USD`;
const gptOct = `Page 1 of 1 Receipt Invoice number NVDNORTP${N}0003 Receipt number 2301${N}1573${N}8226 Date paid October 12, 2026 OpenAI OpCo, LLC 1455 3rd Street San Francisco, California 94158 United States ar@openai.com Bill to Avernek Technologies Ptv. Ltd. Satdobato Lalitpur 44600 Nepal billing@example.com $20.00 paid on October 12, 2026 Description Qty Unit price Amount ChatGPT Plus Subscription (per seat) Oct 11${N}Nov 11, 2026 1 $20.00 $20.00 Subtotal $20.00 Total $20.00 Amount paid $20.00 Payment history Payment method Date Amount paid Receipt number Visa - 7310 October 12, 2026 $20.00 2301${N}1573${N} 8226`;
const gptSept = `Page 1 of 1 Receipt Invoice number NVDNORTP${N}0002 Receipt number 2256${N}6446${N}2727 Date paid September 11, 2026 OpenAI OpCo, LLC 1455 3rd Street San Francisco, California 94158 United States ar@openai.com Bill to Swornim Sanjel Satdobato Lalitpur 44600 Nepal billing@example.com $20.00 paid on September 11, 2026 Description Qty Unit price Amount ChatGPT Plus Subscription (per seat) Sep 11${N}Oct 11, 2026 1 $20.00 $20.00 Subtotal $20.00 Total $20.00 Amount paid $20.00`;

describe("parseReceiptText — AI subscription receipts", () => {
  it("reads a Claude receipt billed to the company", () => {
    const read = parseReceiptText(claudeSept);
    expect(read).toMatchObject({
      knownVendor: "Anthropic (Claude)",
      vendor: "Anthropic (Claude)",
      description: "Claude Pro · Sep 12 – Oct 12, 2026",
      date: "2026-09-12",
      currency: "USD",
      total: 20,
      tax: null,
      number: "2729-7850-5528",
      category: "AI / Token Usage",
    });
    expect(read.warnings).toEqual([]);
  });

  it("warns when a receipt is not billed to Avernek", () => {
    expect(parseReceiptText(claudeAug).warnings[0]).toMatch(/not the company/);
    expect(parseReceiptText(gptSept).warnings[0]).toMatch(/Billed to “Swornim Sanjel”/);
  });

  it("spots the Ptv. typo on the billing name", () => {
    const read = parseReceiptText(gptOct);
    expect(read).toMatchObject({ knownVendor: "OpenAI (GPT)", date: "2026-10-12", total: 20, number: "2301-1573-8226" });
    expect(read.description).toBe("ChatGPT Plus Subscription · Oct 11 – Nov 11, 2026");
    expect(read.warnings[0]).toMatch(/Ptv/);
  });

  it("flags a $0 trial invoice as nothing to record", () => {
    const read = parseReceiptText(claudeTrial);
    expect(read.total).toBe(0);
    expect(read.date).toBe("2026-08-11");
    expect(read.warnings.some((warning) => warning.includes("$0 trial"))).toBe(true);
  });

  it("reads a printed tax line and explains it cannot be claimed", () => {
    const withTax = claudeSept.replace("Subtotal $20.00 Total $20.00 Amount paid $20.00", "Subtotal $17.70 Tax (13%) $2.30 Total $20.00 Amount paid $20.00");
    const read = parseReceiptText(withTax);
    expect(read.total).toBe(20);
    expect(read.tax).toBe(2.3);
    expect(read.warnings.some((warning) => warning.includes("cannot be claimed"))).toBe(true);
  });
});

describe("parseReceiptText — Nepali bills", () => {
  it("reads total and VAT but not the VAT registration number", () => {
    const read = parseReceiptText(
      "Himalayan Java Cafe VAT No: 301234567 Bill No: 1042 Date: 14/10/2026 Cappuccino 2 x 250 Club sandwich 450 Taxable amount Rs 840.71 VAT 13% Rs 109.29 Grand Total Rs 950.00"
    );
    expect(read).toMatchObject({ currency: "NPR", total: 950, tax: 109.29, date: "2026-10-14", number: "1042", category: "Food" });
  });
});

describe("helpers", () => {
  it("reads dates the way Nepal writes them and refuses BS years", () => {
    expect(parseReceiptDate("12/09/2026")).toBe("2026-09-12");
    expect(parseReceiptDate("12 Sep 2026")).toBe("2026-09-12");
    expect(parseReceiptDate("2083/06/26")).toBeNull();
    expect(parseReceiptDate("26/06/2083")).toBeNull();
  });

  it("files cigarettes and soft drinks apart from food", () => {
    expect(guessCategory("2 Coke 1 Marlboro cigarette")).toBe("Drinks & smoke");
    expect(guessCategory("Veg momo and tea")).toBe("Food");
    expect(guessCategory("A4 paper and pens")).toBe("Office Supplies");
  });
});
