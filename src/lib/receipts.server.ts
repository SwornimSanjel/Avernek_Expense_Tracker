import { extractText, getDocumentProxy } from "unpdf";
import { query } from "@/lib/db";
import { aiConfig } from "@/lib/ai/config";
import { readImage } from "@/lib/ai/openrouter";
import { audit } from "@/lib/ai/store";
import { CATEGORY_HINTS, guessCategory, parseReceiptDate, parseReceiptText, type ReceiptRead } from "@/lib/receipts";

/**
 * Server half of reading bills and receipts.
 *
 *   PDF with text (Claude, ChatGPT and other digital receipts) → read from its
 *   text with pdf.js, here on the server. Free; nothing leaves the server.
 *
 *   Photo of a paper bill → there is no text to read. It is sent to the AI
 *   model only when someone presses "Read with AI", one bill at a time, and
 *   the cost is logged in ai_audit_log next to every other AI use.
 */

export type ReceiptScan = ReceiptRead & {
  fileId: string;
  fileName: string;
  contentType: string;
  /** text = read from the PDF (free) · ai = read by the model · none = not read. */
  readBy: "text" | "ai" | "none";
  /** What reading it with AI cost, in USD. */
  costUsd: number | null;
  /** This bill looks already saved. */
  duplicate: string | null;
  /**
   * Expenses already typed in that look like this receipt (same vendor or
   * amount, a few days apart). Saving against one attaches the receipt to it
   * instead of counting the money a second time.
   */
  matches: ExpenseMatchInfo[];
};

export type ExpenseMatchInfo = {
  id: string;
  date: string;
  label: string;
  amount: number;
  currency: string;
  amountNpr: number | null;
  paidFrom: string;
};

const STAGED = "expense_id is null and agreement_id is null and payment_id is null and company_bill_id is null";

/** All the text in a PDF, pages joined. Empty for a scanned (image-only) PDF. */
export async function pdfText(data: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join(" ") : String(text ?? "");
}

const AI_INSTRUCTIONS = `You read one photo of a bill or receipt for a Nepali company's bookkeeping.
Answer with only a JSON object with these keys:
"vendor": shop or company that issued the bill, or null;
"date": the bill date as YYYY-MM-DD in the AD calendar, or null. Nepal writes dates DD/MM/YYYY. If only a Nepali BS date (year 2080 or later) is printed, give null and put it in "bs_date";
"bs_date": the BS date as printed, or null;
"currency": "NPR" or "USD";
"total": the grand total actually paid, VAT included, as a number;
"vat": the VAT amount printed on the bill as a number, or 0 when the bill shows no VAT (a PAN bill);
"bill_no": the bill or invoice number, or null;
"items": what was bought, under 12 words;
"category": one of ${CATEGORY_HINTS.map((hint) => JSON.stringify(hint.name)).join(", ")}, "Miscellaneous". Soft drinks, alcohol and cigarettes are "Drinks & smoke"; meals and snacks are "Food".
Never guess a number you cannot read: use null.`;

type AiAnswer = {
  vendor?: unknown;
  date?: unknown;
  bs_date?: unknown;
  currency?: unknown;
  total?: unknown;
  vat?: unknown;
  bill_no?: unknown;
  items?: unknown;
  category?: unknown;
};

function str(value: unknown, max = 120): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Read one photo with the AI model. Returns null when AI is not set up. */
async function readPhotoWithAi(
  file: { data: Buffer; contentType: string },
  userId: string
): Promise<{ read: ReceiptRead; costUsd: number | null } | null> {
  const config = aiConfig();
  if (!config) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(file.contentType)) {
    return {
      read: emptyRead(["This photo format can't be read by AI. Take the photo again as JPG, or type the amounts."]),
      costUsd: null,
    };
  }
  const started = Date.now();
  try {
    const answer = await readImage(config, {
      instructions: AI_INSTRUCTIONS,
      dataUrl: `data:${file.contentType};base64,${file.data.toString("base64")}`,
    });
    let parsed: AiAnswer = {};
    try {
      parsed = JSON.parse(answer.content ?? "{}") as AiAnswer;
    } catch {
      parsed = {};
    }
    const categoryText = str(parsed.category);
    const category =
      categoryText && [...CATEGORY_HINTS.map((hint) => hint.name), "Miscellaneous"].includes(categoryText)
        ? categoryText
        : guessCategory(`${str(parsed.vendor) ?? ""} ${str(parsed.items) ?? ""}`);
    const date = str(parsed.date);
    const warnings: string[] = [];
    const bsDate = str(parsed.bs_date);
    if (!date && bsDate) warnings.push(`The bill shows a Nepali date (${bsDate}). Check the date before saving.`);
    const read: ReceiptRead = {
      vendor: str(parsed.vendor),
      knownVendor: null,
      description: str(parsed.items, 200),
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : date ? parseReceiptDate(date) : null,
      currency: parsed.currency === "USD" ? "USD" : "NPR",
      total: num(parsed.total),
      tax: num(parsed.vat),
      number: str(parsed.bill_no, 60),
      category,
      warnings,
    };
    await audit({
      userId,
      kind: "receipt",
      tool: "read_bill_photo",
      status: "ok",
      model: answer.model,
      promptTokens: answer.usage.promptTokens,
      completionTokens: answer.usage.completionTokens,
      costUsd: answer.usage.costUsd,
      latencyMs: Date.now() - started,
    });
    return { read, costUsd: answer.usage.costUsd };
  } catch (error) {
    await audit({
      userId,
      kind: "receipt",
      tool: "read_bill_photo",
      status: "error",
      detail: { message: error instanceof Error ? error.message : String(error) },
      latencyMs: Date.now() - started,
    });
    return { read: emptyRead(["AI could not read this photo. Type the amounts, or try a clearer photo."]), costUsd: null };
  }
}

function emptyRead(warnings: string[] = []): ReceiptRead {
  return {
    vendor: null,
    knownVendor: null,
    description: null,
    date: null,
    currency: null,
    total: null,
    tax: null,
    number: null,
    category: null,
    warnings,
  };
}

/** Is this bill already saved? Same file, or the same receipt/bill number. */
async function findDuplicate(sha256: string, read: ReceiptRead): Promise<string | null> {
  const sameFile = await query<{ label: string }>(
    `select coalesce(b.description, e.note, 'a record') as label
       from public.attachments a
       left join public.company_bills b on b.id = a.company_bill_id
       left join public.expenses e on e.id = a.expense_id
      where a.sha256 = $1 and not (${STAGED.replace(/(\w+_id)/g, "a.$1")})
      limit 1`,
    [sha256]
  );
  if (sameFile[0]) return `This exact file is already saved (“${sameFile[0].label}”).`;
  if (!read.number) return null;
  const sameNumber = await query<{ label: string }>(
    `select description as label from public.company_bills where bill_number = $1
     union all
     select coalesce(note, 'an expense') from public.expenses where note ilike '%' || $1 || '%'
     limit 1`,
    [read.number]
  );
  return sameNumber[0] ? `Receipt ${read.number} is already recorded (“${sameNumber[0].label}”).` : null;
}

/**
 * Expenses that are probably this same spending: within 5 days, same amount
 * (1% slack for a rounded NPR figure) and, for a known vendor such as
 * Anthropic or OpenAI, the same vendor — two $20 subscriptions from different
 * companies are not the same payment. Expenses already counted for a bill are
 * skipped.
 */
export async function findMatchingExpenses(read: Pick<ReceiptRead, "date" | "total" | "currency" | "knownVendor">): Promise<ExpenseMatchInfo[]> {
  if (!read.date || !read.total || read.total <= 0) return [];
  const currency = read.currency ?? "NPR";
  const rows = await query<{
    id: string;
    expense_date: string;
    amount: string;
    currency: string;
    amount_npr: string | null;
    label: string;
    funding_source: string;
    account: string | null;
    payer: string | null;
  }>(
    `select e.id, e.expense_date, e.amount, e.currency, e.amount_npr,
            coalesce(nullif(e.note, ''), v.name, 'Expense') as label,
            e.funding_source, ma.name as account, u.name as payer
       from public.expenses e
       left join public.vendors v on v.id = e.vendor_id
       left join public.money_accounts ma on ma.id = e.money_account_id
       left join public.users u on u.id = e.paid_by_user_id
      where abs(e.expense_date - $1::date) <= case when $2 = 'USD' then 7 else 10 end
        and (
          -- the same amount in the same currency (1-2% slack for rounding)
          (e.currency = $2 and abs(e.amount - $3) <= greatest(case when $2 = 'USD' then 1 else 2 end, $3 * 0.02))
          -- an NPR receipt against an expense typed in NPR
          or ($2 = 'NPR' and abs(coalesce(e.amount_npr, e.amount) - $3) <= greatest(2, $3 * 0.01))
          -- a USD receipt that was typed in as the NPR the bank charged
          or ($2 = 'USD' and e.currency = 'NPR' and e.amount between $3 * 120 and $3 * 175)
        )
        and ($4::text is null
             or v.name = $4
             or e.note ilike '%' || split_part($4, ' ', 1) || '%'
             or e.note ilike '%' || replace(split_part($4, '(', 2), ')', '') || '%')
        and not exists (select 1 from public.company_bills b where b.expense_id = e.id)
      order by abs(e.expense_date - $1::date), e.created_at desc
      limit 4`,
    [read.date, currency, read.total, read.knownVendor]
  );
  return rows.map((row) => ({
    id: row.id,
    date: row.expense_date,
    label: row.label,
    amount: Number(row.amount),
    currency: row.currency,
    amountNpr: row.amount_npr != null ? Number(row.amount_npr) : null,
    paidFrom: row.funding_source === "company_funds" ? row.account ?? "a company account" : `${row.payer ?? "a partner"}'s own money`,
  }));
}

/**
 * Read staged uploads. PDFs are read from their text for free; photos are read
 * by AI only when `withAi` is true.
 */
export async function scanStagedFiles(ids: string[], withAi: boolean, userId: string): Promise<ReceiptScan[]> {
  const files = await query<{ id: string; file_name: string; content_type: string; sha256: string; data: Buffer }>(
    `select id, file_name, content_type, sha256, data from public.attachments
      where id = any($1::uuid[]) and ${STAGED}`,
    [ids]
  );
  const byId = new Map(files.map((file) => [file.id, file]));
  const scans: ReceiptScan[] = [];
  for (const id of ids) {
    const file = byId.get(id);
    if (!file) continue;
    let read = emptyRead();
    let readBy: ReceiptScan["readBy"] = "none";
    let costUsd: number | null = null;
    if (file.content_type === "application/pdf") {
      let text = "";
      try {
        text = await pdfText(file.data);
      } catch {
        text = "";
      }
      if (text.replace(/\s/g, "").length > 20) {
        read = parseReceiptText(text);
        readBy = "text";
      } else {
        read = emptyRead(["This PDF is a scan with no text inside. Upload a photo of it to read it with AI, or type the amounts."]);
      }
    } else if (withAi) {
      const result = await readPhotoWithAi({ data: file.data, contentType: file.content_type }, userId);
      if (result) {
        read = result.read;
        readBy = result.read.total != null ? "ai" : "none";
        costUsd = result.costUsd;
      } else {
        read = emptyRead(["The AI assistant is not set up on this server. Type the amounts."]);
      }
    }
    scans.push({
      ...read,
      fileId: file.id,
      fileName: file.file_name,
      contentType: file.content_type,
      readBy,
      costUsd,
      duplicate: await findDuplicate(file.sha256, read),
      matches: await findMatchingExpenses(read),
    });
  }
  return scans;
}
