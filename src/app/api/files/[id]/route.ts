import { one } from "@/lib/db";
import { getSession, type CurrentUser } from "@/lib/auth/server";
import { canView, ledgerOf } from "@/lib/access";

/**
 * GET /api/files/:id — stream one stored attachment to a signed-in user.
 *
 * The content type is the one detected from the file's bytes at upload time
 * (lib/attachments.ts), never the browser's claim, so only PDFs and images are
 * ever served from this origin. `?download=1` saves instead of opening.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  if (!(await mayOpen(session, id))) return new Response("Not found", { status: 404 });

  const file = await one<{ file_name: string; content_type: string; data: Buffer }>(
    `select file_name, content_type, data from public.attachments where id = $1`,
    [id]
  );
  if (!file) return new Response("Not found", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  // Browsers other than Safari cannot display HEIC, so it is always a download.
  const inline = !download && !/^image\/hei[cf]$/.test(file.content_type);
  // Quotes, backslashes and semicolons would break out of the header parameter.
  const asciiName = file.file_name.replace(/[^\x20-\x7e]|["\\;]/g, "_");

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.content_type,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/**
 * A file opens only for someone who may see the record it belongs to: an
 * expense's bill for the kinds of expenses they may see, a company bill on
 * the Bills page, an agreement or VAT bill on Income or Clients. A file not
 * yet saved on a record opens only for the person who uploaded it.
 */
async function mayOpen(session: CurrentUser, id: string): Promise<boolean> {
  if (session.access.full) return true;
  const row = await one<{
    kind: string;
    uploaded_by: string | null;
    expense_id: string | null;
    company_bill_id: string | null;
    agreement_id: string | null;
    payment_id: string | null;
    funding_source: string | null;
    money_account_id: string | null;
    account_kind: string | null;
  }>(
    `select a.kind, a.uploaded_by, a.expense_id, a.company_bill_id, a.agreement_id, a.payment_id,
            e.funding_source, e.money_account_id, ma.kind as account_kind
       from public.attachments a
       left join public.expenses e on e.id = a.expense_id
       left join public.money_accounts ma on ma.id = e.money_account_id
      where a.id = $1`,
    [id]
  );
  if (!row) return false;
  if (row.expense_id && row.funding_source) {
    const vat = new Set(row.account_kind === "company_bank" && row.money_account_id ? [row.money_account_id] : []);
    return session.access.expenses.includes(ledgerOf({ funding_source: row.funding_source, money_account_id: row.money_account_id }, vat));
  }
  if (row.company_bill_id) return canView(session.access, "bills");
  if (row.agreement_id || row.payment_id) return canView(session.access, "income") || canView(session.access, "clients");
  return row.uploaded_by === session.sub;
}
