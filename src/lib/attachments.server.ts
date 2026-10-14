import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  cleanFileName,
  formatFileSize,
  sniffAttachmentType,
  type Attachment,
  type AttachmentKind,
} from "@/lib/attachments";
import { one, query } from "@/lib/db";

/**
 * Server-side half of attachments.
 *
 * Files are uploaded on their own, one per request, to POST /api/files the
 * moment they are picked (see stageUpload). That stores the bytes as a
 * "staged" row: it has a kind but no owner. Forms then post only the staged
 * ids, and saving the record claims them by setting the owner column — inside
 * the record's own transaction, so a record is never saved with half its files.
 *
 * Keeping photo bytes out of the form posts matters: Cloudflare's firewall
 * occasionally blocked page posts that carried them.
 */

type Db = Pick<PoolClient, "query">;

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

export const ATTACHMENT_KINDS = Object.keys(OWNER_COLUMN) as AttachmentKind[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGED = "expense_id is null and agreement_id is null and payment_id is null and company_bill_id is null";

/** A staged upload referenced by a form. */
export type FileUpload = { id: string };

// -----------------------------------------------------------------------------
// Upload: store one file as staged
// -----------------------------------------------------------------------------

/**
 * Prove what a file is and store it, unattached. Returns its metadata.
 * Also clears staged files older than a day that no form ever claimed.
 */
export async function stageUpload(input: {
  kind: AttachmentKind;
  fileName: string;
  data: Buffer;
  uploadedBy: string;
}): Promise<Attachment> {
  if (input.data.length === 0) throw new Error("That file is empty.");
  if (input.data.length > ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `${input.fileName} is ${formatFileSize(input.data.length)}; each file must be under ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`
    );
  }
  const contentType = sniffAttachmentType(input.data);
  if (!contentType) {
    throw new Error(`${input.fileName} is not a PDF or an image (JPG, PNG, WEBP, HEIC).`);
  }
  const sha256 = createHash("sha256").update(input.data).digest("hex");

  const row = await one<Attachment>(
    `insert into public.attachments
       (kind, file_name, content_type, size_bytes, sha256, data, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, kind, expense_id, agreement_id, payment_id, company_bill_id,
               file_name, content_type, size_bytes, created_at`,
    [input.kind, cleanFileName(input.fileName), contentType, input.data.length, sha256, input.data, input.uploadedBy]
  );

  await query(
    `delete from public.attachments where ${STAGED} and created_at < now() - interval '1 day'`
  );
  return row!;
}

// -----------------------------------------------------------------------------
// Forms: read staged ids, check room, claim them
// -----------------------------------------------------------------------------

/**
 * The staged files a form posted under `field` (one id per value). No file is
 * fine. Raw file bytes are refused: only a page from before this change would
 * send them, and it is told to reload.
 */
export async function readUploads(formData: FormData, field: string): Promise<FileUpload[]> {
  const values = formData.getAll(field);
  if (values.some((value) => value instanceof File && value.size > 0)) {
    throw new Error("This page is out of date. Reload it and add the files again.");
  }
  const ids = [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value.length > 0)
    ),
  ];
  if (ids.length > ATTACHMENT_MAX_FILES) {
    throw new Error(`Attach at most ${ATTACHMENT_MAX_FILES} files at once.`);
  }
  if (!ids.every((id) => UUID_RE.test(id))) throw new Error("One of the uploaded files was not found.");
  return ids.map((id) => ({ id }));
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
 * Attach staged files to their owner. Run inside the owner's transaction.
 * A file identical to one the owner already has is dropped instead of being
 * attached twice.
 */
export async function insertAttachments(
  client: Db,
  owner: AttachmentOwner,
  uploads: FileUpload[],
  _uploadedBy: string
) {
  if (uploads.length === 0) return;
  const ids = uploads.map((upload) => upload.id);
  const column = OWNER_COLUMN[owner.kind];

  const staged = await client.query<{ id: string; sha256: string }>(
    `select id, sha256 from public.attachments
      where id = any($1::uuid[]) and kind = $2 and ${STAGED}
      for update`,
    [ids, owner.kind]
  );
  if (staged.rows.length !== ids.length) {
    throw new Error("Some uploaded files expired or were already used. Remove them, add them again and save.");
  }

  const existing = await client.query<{ sha256: string }>(
    `select sha256 from public.attachments where ${column} = $1`,
    [owner.id]
  );
  const seen = new Set(existing.rows.map((row) => row.sha256));
  const keep: string[] = [];
  const duplicate: string[] = [];
  for (const row of staged.rows) {
    if (seen.has(row.sha256)) duplicate.push(row.id);
    else {
      seen.add(row.sha256);
      keep.push(row.id);
    }
  }
  if (duplicate.length) {
    await client.query(`delete from public.attachments where id = any($1::uuid[])`, [duplicate]);
  }
  if (keep.length) {
    await client.query(`update public.attachments set ${column} = $1 where id = any($2::uuid[])`, [
      owner.id,
      keep,
    ]);
  }
}

/**
 * Read several upload fields at once, one per owner, named `${prefix}${ownerId}`
 * (e.g. `vat_bill_files:<paymentId>`). Returns only owners that got files.
 */
export async function readPrefixedUploads(
  formData: FormData,
  prefix: string
): Promise<Map<string, FileUpload[]>> {
  const fields = [...new Set([...formData.keys()].filter((key) => key.startsWith(prefix)))];
  const result = new Map<string, FileUpload[]>();
  for (const field of fields) {
    const uploads = await readUploads(formData, field);
    if (uploads.length) result.set(field.slice(prefix.length), uploads);
  }
  return result;
}

/**
 * VAT bills posted from a client's "VAT bills" tab or panel: one field per
 * payment. Every payment must belong to `agreementId` and have room left.
 */
export async function readClientVatBills(
  formData: FormData,
  agreementId: string
): Promise<Map<string, FileUpload[]>> {
  const byPayment = await readPrefixedUploads(formData, "vat_bill_files:");
  if (byPayment.size === 0) return byPayment;
  const ids = [...byPayment.keys()];
  if (!ids.every((id) => UUID_RE.test(id))) throw new Error("That payment was not found.");
  const owned = await query<{ id: string }>(
    `select id from public.income_payments where agreement_id = $1 and id = any($2::uuid[])`,
    [agreementId, ids]
  );
  if (owned.length !== ids.length) {
    throw new Error("A VAT bill was attached to a payment that does not belong to this client.");
  }
  for (const [id, uploads] of byPayment) await assertRoomFor({ kind: "vat_bill", id }, uploads.length);
  return byPayment;
}

export async function insertClientVatBills(
  client: Db,
  byPayment: Map<string, FileUpload[]>,
  uploadedBy: string
) {
  for (const [id, uploads] of byPayment) {
    await insertAttachments(client, { kind: "vat_bill", id }, uploads, uploadedBy);
  }
}
