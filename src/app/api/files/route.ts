import { getSession } from "@/lib/auth/server";
import { isAppOwner } from "@/lib/authz";
import { ATTACHMENT_MAX_BYTES, formatFileSize, type AttachmentKind } from "@/lib/attachments";
import { ATTACHMENT_KINDS, stageUpload } from "@/lib/attachments.server";

/**
 * POST /api/files — upload ONE file, raw bytes in the body.
 *
 *   X-File-Kind: expense_bill | client_agreement | vat_bill | company_bill
 *   X-File-Name: the original file name, URI-encoded
 *
 * The file is stored "staged" (no owner yet) and its id is returned; the form
 * it was picked in claims it on save. Uploading files separately keeps photo
 * bytes out of page form posts, which Cloudflare's firewall sometimes blocked.
 * Always answers JSON so the browser can show exactly what went wrong.
 */
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return fail(401, "You are signed out. Sign in again and retry.");
  if (!isAppOwner(session)) return fail(403, "Only an administrator can upload files.");

  const kind = request.headers.get("x-file-kind") as AttachmentKind | null;
  if (!kind || !ATTACHMENT_KINDS.includes(kind)) return fail(400, "Unknown upload type.");

  let fileName = "file";
  try {
    fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "file") || "file";
  } catch {
    fileName = "file";
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > ATTACHMENT_MAX_BYTES) {
    return fail(413, `${fileName} is ${formatFileSize(declared)}; each file must be under ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`);
  }

  try {
    const data = Buffer.from(await request.arrayBuffer());
    const file = await stageUpload({ kind, fileName, data, uploadedBy: session.sub });
    return Response.json({ file });
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Could not store the file.");
  }
}
