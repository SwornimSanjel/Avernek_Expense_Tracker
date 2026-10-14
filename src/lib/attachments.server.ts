import { createHash } from "node:crypto";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  cleanFileName,
  formatFileSize,
  sniffAttachmentType,
  type AttachmentContentType,
  type AttachmentKind,
} from "@/lib/attachments";
import { one } from "@/lib/db";

/**
 * Server-side half of attachments: read uploaded files out of a form, prove
 * what they are, and store them against exactly one owner record.
 */

type Queryable = { query: (text: string, params?: unknown[]) => Promise<unknown> };

export type AttachmentOwner =
  | { kind: "expense_bill"; id: string }
  | { kind: "client_agreement"; id: string }
  | { kind: "vat_bill"; id: string }
  | { kind: "company_bill"; id: string };

const OWNER_COLUMN: Record<AttachmentKind, string> = {
  expense_bill: "expense_id",
  client_agreement: "agreement_id",
  vat_bill: "payment_id",
  company_bill: "company_bill_id",
};

export type FileUpload = {
  fileName: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
  sha256: string;
  data: Buffer;
};

/**
 * Read the files posted under `field`. No file is fine. Anything that is not a
 * real PDF or image, or is too large, is rejected with a message that names the
 * file — before any record is written.
 */
export async function readUploads(formData: FormData, field: string): Promise<FileUpload[]> {
  const files = formData
    .getAll(field)
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) return [];
  if (files.length > ATTACHMENT_MAX_FILES) {
    throw new Error(`Attach at most ${ATTACHMENT_MAX_FILES} files at once.`);
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
    throw new Error(
      `These files add up to ${formatFileSize(total)}; save at most ${formatFileSize(ATTACHMENT_MAX_TOTAL_BYTES)} at a time.`
    );
  }

  const uploads: FileUpload[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new Error(
        `${file.name} is ${formatFileSize(file.size)}; each file must be under ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`
      );
    }
    const data = Buffer.from(await file.arrayBuffer());
    const contentType = sniffAttachmentType(data);
    if (!contentType) {
      throw new Error(`${file.name} is not a PDF or an image (JPG, PNG, WEBP, HEIC).`);
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    uploads.push({
      fileName: cleanFileName(file.name),
      contentType,
      sizeBytes: data.length,
      sha256,
      data,
    });
  }
  return uploads;
}

/** How many files the owner already has. */
export async function countAttachments(owner: AttachmentOwner): Promise<number> {
  const row = await one<{ count: string }>(
    `select count(*) as count from public.attachments
      where kind = $1 and ${OWNER_COLUMN[owner.kind]} = $2`,
    [owner.kind, owner.id]
  );
  return Number(row?.count ?? 0);
}

/** Refuse a save that would push the owner past the per-record limit. */
export async function assertRoomFor(owner: AttachmentOwner, adding: number) {
  if (adding === 0) return;
  const existing = await countAttachments(owner);
  if (existing + adding > ATTACHMENT_MAX_FILES) {
    throw new Error(
      `This record already has ${existing} file${existing === 1 ? "" : "s"}; at most ${ATTACHMENT_MAX_FILES} fit. Remove one before adding more.`
    );
  }
}

/**
 * Store the files. Run inside the owner's transaction so a record is never
 * saved with half its files. The same file twice on one owner is skipped.
 */
export async function insertAttachments(
  client: Queryable,
  owner: AttachmentOwner,
  uploads: FileUpload[],
  uploadedBy: string
) {
  const column = OWNER_COLUMN[owner.kind];
  for (const upload of uploads) {
    await client.query(
      `insert into public.attachments
         (kind, ${column}, file_name, content_type, size_bytes, sha256, data, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict do nothing`,
      [
        owner.kind,
        owner.id,
        upload.fileName,
        upload.contentType,
        upload.sizeBytes,
        upload.sha256,
        upload.data,
        uploadedBy,
      ]
    );
  }
}
