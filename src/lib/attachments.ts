/**
 * Files attached to records: expense bills, signed agreement pages, VAT bills
 * issued for a client payment, and company bills.
 *
 * The browser-reported MIME type and file name are only hints. What a file is
 * gets decided from its first bytes, so a renamed HTML or script file can never
 * be stored and later served back from this origin as a "bill".
 *
 * Shared by the upload field (browser) and the server actions, so it must stay
 * free of Node-only imports. Server-side reading and writing lives in
 * attachments.server.ts.
 */

export type AttachmentKind = "expense_bill" | "client_agreement" | "vat_bill" | "company_bill";

/** Metadata only — the file bytes are never loaded into lists. */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  expense_id: string | null;
  agreement_id: string | null;
  payment_id: string | null;
  company_bill_id: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/** Columns safe to select for lists (everything except `data`). */
export const ATTACHMENT_COLUMNS =
  "id, kind, expense_id, agreement_id, payment_id, company_bill_id, file_name, content_type, size_bytes, created_at";

/** Largest single file the database accepts (matches the table's check). */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
/** Most files one record can hold. */
export const ATTACHMENT_MAX_FILES = 10;
/** Most bytes one save may carry; next.config.ts allows a little more. */
export const ATTACHMENT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/** `accept` for file inputs: phones offer camera, photos and files. */
export const ATTACHMENT_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

export type AttachmentContentType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif";

/** What a file really is, from its leading bytes. Null when it is not allowed. */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentContentType | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  // PDFs may carry a few bytes of junk before the header; the spec allows 1 KB.
  const head = ascii(0, Math.min(bytes.length, 1024));
  if (head.includes("%PDF-")) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
  }
  return null;
}

/** Quick pre-check in the browser, before any bytes are sent. */
export function looksLikeAttachment(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (type && /^(application\/pdf|image\/(jpeg|pjpeg|png|webp|heic|heif))$/.test(type)) return true;
  return /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

export function isImageAttachment(contentType: string): boolean {
  return /^image\/(jpeg|png|webp)$/.test(contentType);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Keep a readable name but drop path parts and characters that break headers. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 180);
  return cleaned || "file";
}

export function attachmentUrl(id: string, download = false): string {
  return `/api/files/${id}${download ? "?download=1" : ""}`;
}
