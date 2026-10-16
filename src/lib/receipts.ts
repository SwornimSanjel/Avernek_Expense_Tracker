/**
 * Reading a bill or receipt into the fields of a draft — with no AI.
 *
 * Digital receipts (Anthropic, OpenAI and other Stripe-style receipts, and any
 * PDF with real text) are read from their text: vendor, date, amount, the tax
 * line if one is printed, invoice/receipt numbers and the billing period. This
 * costs nothing and sends nothing anywhere. Photos of paper bills have no text
 * to read, so they are read by the AI model only when someone asks (see
 * receipts.server.ts) and the result is checked here the same way.
 *
 * Client-safe: no Node imports. Shared by the server reader and the review
 * screen.
 */

export type ReceiptCurrency = "NPR" | "USD";

/** What a receipt says, as best it could be read. Every field can be corrected. */
export type ReceiptRead = {
  /** Who issued it: "Anthropic (Claude)", "OpenAI (GPT)", "Cafe Mitra"… */
  vendor: string | null;
  /** Matches a vendor already in the app: "Anthropic (Claude)" / "OpenAI (GPT)". */
  knownVendor: "Anthropic (Claude)" | "OpenAI (GPT)" | null;
  /** "Claude Pro · Sep 12 – Oct 12, 2026" */
  description: string | null;
  date: string | null;
  currency: ReceiptCurrency | null;
  /** What was paid, tax included. */
  total: number | null;
  /** Tax printed on the receipt (foreign sales tax / VAT / Nepali VAT). */
  tax: number | null;
  /** Bill, invoice or receipt number — used to spot duplicates. */
  number: string | null;
  /** Category the bill most likely belongs to, by name. */
  category: string | null;
  /** Problems worth knowing before saving. */
  warnings: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (!year || !month || !day || month > 12 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** "September 12, 2026" / "12 Sep 2026" / "2026-09-12" / "12/09/2026" (Nepal writes DD/MM). */
function monthOf(word: string): number | undefined {
  const lower = word.toLowerCase();
  return MONTHS[lower.slice(0, 4)] ?? MONTHS[lower.slice(0, 3)];
}

export function parseReceiptDate(text: string): string | null {
  let match = text.match(/\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (match && monthOf(match[1])) return iso(Number(match[3]), monthOf(match[1])!, Number(match[2]));
  match = text.match(/\b(\d{1,2})\s+([A-Z][a-z]{2,8})\.?,?\s+(\d{4})\b/);
  if (match && monthOf(match[2])) return iso(Number(match[3]), monthOf(match[2])!, Number(match[1]));
  match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (match) {
    const year = Number(match[3]);
    // A Nepali (BS) year is 56-57 years ahead; it cannot be read as AD.
    if (year > 2050) return null;
    return iso(year, Number(match[2]), Number(match[1]));
  }
  return null;
}

function amount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** The text pdf.js gives back: one line, with some dashes turned into NULs. */
export function normalizeReceiptText(raw: string): string {
  return raw
    .replace(/\u0000/g, "-")
    .replace(/[‒-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Category names used across the app (see categories). */
export const CATEGORY_HINTS: { name: string; test: RegExp }[] = [
  { name: "AI / Token Usage", test: /\b(anthropic|claude|openai|chatgpt|gpt-?\d|openrouter|gemini|perplexity|midjourney)\b/i },
  { name: "Drinks & smoke", test: /\b(beer|wine|whisk(e)?y|vodka|alcohol|liquor|cigar(ette)?s?|tobacco|smoke|coke|pepsi|sprite|fanta|soft drinks?|red bull|energy drink|beverages?)\b/i },
  { name: "Food", test: /\b(food|lunch|dinner|breakfast|khaja|momo|chowmein|cafe|café|restaurant|snacks?|tea|coffee|bakery|kitchen|pizza|burger)\b/i },
  { name: "Office Supplies", test: /\b(stationer(y|s)?|paper|printing|print|notebook|pens?|photocopy|xerox|toner|ink|file folder)\b/i },
  { name: "Professional fees", test: /\b(lawyer|legal|advocate|law firm|audit|accountant|consultancy|consulting)\b/i },
  { name: "Software / SaaS", test: /\b(vercel|google workspace|google drive|domain|hosting|capcut|canva|n8n|notion|github|figma)\b/i },
  { name: "Travel", test: /\b(petrol|fuel|taxi|pathao|indrive|ride|bus fare|flight|airlines?)\b/i },
  { name: "Ad Spend", test: /\b(meta ads|facebook ads|google ads|boost(ed)? post)\b/i },
  { name: "Phone / Recharge", test: /\b(recharge|ncell|ntc|nepal telecom|top-?up)\b/i },
];

export function guessCategory(text: string): string | null {
  return CATEGORY_HINTS.find((hint) => hint.test.test(text))?.name ?? null;
}

/**
 * Read a receipt's text. Built for the Stripe receipts Anthropic and OpenAI
 * send (Receipt / Invoice number / Date paid / Subtotal / Tax / Total / Amount
 * paid), with general fallbacks for other printed bills.
 */
export function parseReceiptText(raw: string): ReceiptRead {
  const text = normalizeReceiptText(raw);
  const warnings: string[] = [];

  const anthropic = /\banthropic\b/i.test(text);
  const openai = /\bopenai\b/i.test(text);
  const knownVendor = anthropic ? "Anthropic (Claude)" : openai ? "OpenAI (GPT)" : null;

  // --- currency and amounts -------------------------------------------------
  const usd = /\$\s?\d/.test(text) || /\bUSD\b/.test(text);
  const npr = /\b(NPR|Rs\.?|रु)\s?\d/i.test(text);
  const currency: ReceiptCurrency | null = usd && !npr ? "USD" : npr ? "NPR" : null;
  const num = String.raw`(?:\$|USD|NPR|Rs\.?)?\s?([\d,]+(?:\.\d{1,2})?)`;
  const pick = (labels: string) => {
    const re = new RegExp(String.raw`\b(?:${labels})\b[^\d$]{0,20}${num}`, "i");
    return amount(text.match(re)?.[1]);
  };
  const paid = pick("Amount paid");
  const due = pick("Amount due");
  const grand = pick("Grand total|Net amount|Net total|Total amount");
  const total = pick("Total");
  const subtotal = pick("Subtotal|Sub total|Taxable amount");
  // "Tax", "Sales tax", "VAT (13%)", "GST" — but not "Taxable amount" or "PAN".
  const taxMatch = text.match(
    // "VAT No: 301234567" is a registration number, not an amount.
    new RegExp(
      String.raw`\b(?:sales tax|vat|gst|tax)(?!able)\b(?!\s*(?:no\b|number|reg|registration|#|pan|id\b))(?:\s*\(?\d{1,2}(?:\.\d+)?%\)?)?[^\d$a-z]{0,6}${num}`,
      "i"
    )
  );
  const tax = amount(taxMatch?.[1]);
  const finalTotal = paid ?? grand ?? total ?? due ?? null;

  // --- what it was for --------------------------------------------------------
  const period = text.match(/\b([A-Z][a-z]{2} \d{1,2})\s?-\s?((?:[A-Z][a-z]{2} )?\d{1,2}, \d{4})\b/);
  const plan =
    text.match(/\b(Claude (?:Pro|Max|Team|Enterprise)[^$]*?)(?= [A-Z][a-z]{2} \d{1,2}\s?-| \d+ \$)/)?.[1] ??
    text.match(/\b(ChatGPT (?:Plus|Pro|Team|Business|Enterprise)(?: Subscription)?)/)?.[1] ??
    text.match(/\b(Trial period for [A-Za-z ]+?)(?= [A-Z][a-z]{2} \d{1,2}\s?-)/)?.[1] ??
    null;
  const description = plan
    ? `${plan.trim()}${period ? ` · ${period[1]} – ${period[2]}` : ""}`
    : null;

  // --- dates and numbers -----------------------------------------------------
  const dateText =
    text.match(/\bDate paid\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ??
    text.match(/\bDate of issue\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ??
    text.match(/\b(?:Bill|Invoice)?\s?Date\s*:?\s*([\d/.-]{8,10}|\d{1,2} [A-Z][a-z]+ \d{4}|[A-Z][a-z]+ \d{1,2}, \d{4})/i)?.[1] ??
    null;
  const date = dateText ? parseReceiptDate(dateText) : parseReceiptDate(text);
  const number =
    text.match(/\bReceipt number\s+([\d-]{6,})/)?.[1] ??
    text.match(/\bInvoice number\s+([A-Z0-9-]{6,})/)?.[1] ??
    text.match(/\b(?:Bill|Invoice) no\.?\s*:?\s*([A-Z0-9/-]{2,})/i)?.[1] ??
    null;

  // --- who it is billed to ------------------------------------------------------
  if (knownVendor) {
    const billTo = text.match(/\bBill to\s+(.+?)\s+(?:Satdobato|Lalitpur|Kathmandu|Bhaktapur|Nepal)\b/)?.[1]?.trim() ?? null;
    if (billTo && !/avernek technologies p[vt]{2}\.? ltd/i.test(billTo)) {
      warnings.push(
        `Billed to “${billTo}”, not the company. Change the billing name to “Avernek Technologies Pvt. Ltd.” (with the PAN) in ${anthropic ? "Claude" : "ChatGPT"} settings so future receipts count as company bills.`
      );
    } else if (billTo && /\bPtv\b/i.test(billTo)) {
      warnings.push("The billing name is misspelt “Ptv. Ltd.” — correct it to “Pvt. Ltd.” in the account's billing settings.");
    }
  }
  if (finalTotal === 0) warnings.push("This is a $0 trial invoice: nothing was paid, so there is nothing to record.");
  if (tax && knownVendor) {
    warnings.push("The tax on a foreign receipt is not Nepali VAT: it cannot be claimed from IRD, so it simply counts as part of the expense.");
  }

  return {
    vendor: knownVendor ?? null,
    knownVendor,
    description,
    date,
    currency,
    total: finalTotal,
    tax: tax && finalTotal && tax < finalTotal ? tax : subtotal && finalTotal && finalTotal > subtotal ? Math.round((finalTotal - subtotal) * 100) / 100 : null,
    number,
    category: knownVendor ? "AI / Token Usage" : guessCategory(text),
    warnings,
  };
}
