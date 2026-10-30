import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth/server";
import { canView } from "@/lib/access";
import { resolvePeriod, type ExpenseSearch } from "@/lib/expense-filters";
import { OTHER_INCOME_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/income";
import { accountLabel } from "@/lib/statement";
import { bankAmount } from "@/lib/tax";
import { monthLabel } from "@/lib/dates";
import { csvMoney, csvResponse, fileSlug, type CsvCell } from "@/lib/csv";
import type { IncomePaymentMethod, MoneyAccount, OtherIncomeCategory } from "@/lib/types";

type PaymentRow = {
  id: string;
  paid_on: string;
  client_name: string;
  payment_for: "setup" | "website" | "recurring";
  billing_period_start: string | null;
  billing_stream: "combined" | "ads" | "automation" | null;
  amount: string;
  vat_amount: string;
  tds_amount: string;
  money_account_id: string | null;
  account_name: string | null;
  method: IncomePaymentMethod | null;
  reference: string | null;
  note: string | null;
  vat_bills: string;
};

type OtherRow = {
  received_on: string;
  category: OtherIncomeCategory;
  source_name: string | null;
  description: string;
  amount: string;
  vat_amount: string;
  tds_amount: string;
  money_account_id: string;
  method: IncomePaymentMethod | null;
  reference: string | null;
  note: string | null;
};

const STREAM: Record<string, string> = { ads: "Ads / marketing", automation: "AI automation" };

function paymentFor(row: PaymentRow) {
  if (row.payment_for === "setup") return "Setup fee";
  if (row.payment_for === "website") return "Website";
  const month = row.billing_period_start ? ` · ${monthLabel(row.billing_period_start.slice(0, 7))}` : "";
  const stream = row.billing_stream && STREAM[row.billing_stream] ? ` (${STREAM[row.billing_stream]})` : "";
  return `Monthly fee${stream}${month}`;
}

// GET /api/export/income?period=month|last|year|all|custom&month=&from=&to=&kind=all|clients|other
// -> every rupee that came in during the period: client payments and income
// without a client, newest first, with a total at the bottom.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries()) as ExpenseSearch & { kind?: string };
  if (!sp.period && !sp.month) sp.period = "all";
  const range = resolvePeriod(sp);
  const kind = sp.kind === "clients" || sp.kind === "other" ? sp.kind : "all";
  // Client payments belong to the Income page; income without a client to
  // either Income or Other income.
  const allowed =
    kind === "other"
      ? canView(session.access, "income") || canView(session.access, "other_income")
      : canView(session.access, "income");
  if (!allowed) return new Response("Forbidden", { status: 403 });
  const between = (column: string) => {
    const conditions: string[] = [];
    const params: string[] = [];
    if (range.from) conditions.push(`${column} >= $${params.push(range.from)}`);
    if (range.to) conditions.push(`${column} <= $${params.push(range.to)}`);
    return { where: conditions.length ? `where ${conditions.join(" and ")}` : "", params };
  };
  const paid = between("p.paid_on");
  const received = between("o.received_on");

  const [payments, others, accounts] = await Promise.all([
    kind === "other"
      ? Promise.resolve([] as PaymentRow[])
      : query<PaymentRow>(
          `select p.id, p.paid_on, a.client_name, p.payment_for, p.billing_period_start, p.billing_stream,
                  p.amount, p.vat_amount, p.tds_amount, p.money_account_id, p.account_name,
                  p.method, p.reference, p.note,
                  (select count(*) from public.attachments f where f.kind = 'vat_bill' and f.payment_id = p.id) as vat_bills
             from public.income_payments p
             join public.income_agreements a on a.id = p.agreement_id
           ${paid.where}
            order by p.paid_on desc, p.created_at desc`,
          paid.params
        ),
    kind === "clients"
      ? Promise.resolve([] as OtherRow[])
      : query<OtherRow>(
          `select o.received_on, o.category, o.source_name, o.description, o.amount, o.vat_amount, o.tds_amount,
                  o.money_account_id, o.method, o.reference, o.note
             from public.other_income o
           ${received.where}
            order by o.received_on desc, o.created_at desc`,
          received.params
        ),
    query<MoneyAccount>(`select * from public.money_accounts`),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const accountOf = (id: string | null, fallback: string | null = null) => {
    const account = accountById.get(id ?? "");
    return account ? accountLabel(account) : fallback ?? "";
  };

  type Line = { date: string; cells: CsvCell[]; amount: number; vat: number; tds: number; bank: number };
  const lines: Line[] = [
    ...payments.map((row) => ({
      date: row.paid_on,
      amount: Number(row.amount),
      vat: Number(row.vat_amount),
      tds: Number(row.tds_amount),
      bank: bankAmount(row),
      cells: [
        row.paid_on.slice(0, 10),
        "Client payment",
        row.client_name,
        paymentFor(row),
        csvMoney(row.amount),
        csvMoney(row.vat_amount),
        csvMoney(row.tds_amount),
        csvMoney(bankAmount(row)),
        accountOf(row.money_account_id, row.account_name),
        row.method ? PAYMENT_METHOD_LABELS[row.method] : "",
        row.reference ?? "",
        Number(row.vat_bills) > 0 ? "Yes" : Number(row.vat_amount) > 0 ? "Not attached" : "",
        row.note ?? "",
      ] as CsvCell[],
    })),
    ...others.map((row) => ({
      date: row.received_on,
      amount: Number(row.amount),
      vat: Number(row.vat_amount),
      tds: Number(row.tds_amount),
      bank: bankAmount(row),
      cells: [
        row.received_on.slice(0, 10),
        "Other income",
        row.source_name ?? "",
        `${OTHER_INCOME_LABELS[row.category] ?? "Other income"} · ${row.description}`,
        csvMoney(row.amount),
        csvMoney(row.vat_amount),
        csvMoney(row.tds_amount),
        csvMoney(bankAmount(row)),
        accountOf(row.money_account_id),
        row.method ? PAYMENT_METHOD_LABELS[row.method] : "",
        row.reference ?? "",
        "",
        row.note ?? "",
      ] as CsvCell[],
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const header = [
    "Date",
    "Type",
    "Client / source",
    "What for",
    "Amount (excl. VAT)",
    "VAT",
    "TDS deducted",
    "Reached bank",
    "Account",
    "Method",
    "Reference",
    "VAT bill",
    "Note",
  ];
  const rows: CsvCell[][] = lines.map((line) => line.cells);
  if (lines.length) {
    const sum = (key: "amount" | "vat" | "tds" | "bank") => csvMoney(lines.reduce((total, line) => total + line[key], 0));
    rows.push([], ["Total", `${lines.length} record${lines.length === 1 ? "" : "s"}`, "", "", sum("amount"), sum("vat"), sum("tds"), sum("bank"), "", "", "", "", ""]);
  }

  const what = kind === "other" ? "other-income" : "income";
  return csvResponse(`avernek-${what}-${fileSlug(range.label)}.csv`, header, rows);
}
