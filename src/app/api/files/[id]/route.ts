import { one } from "@/lib/db";
import { getSession } from "@/lib/auth/server";

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
