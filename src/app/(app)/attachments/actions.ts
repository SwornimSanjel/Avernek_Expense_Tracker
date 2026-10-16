"use server";

import { revalidatePath } from "next/cache";
import { exec, one, transaction } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import type { AttachmentKind } from "@/lib/attachments";
import {
  assertRoomFor,
  insertAttachments,
  insertClientVatBills,
  readClientVatBills,
  readUploads,
  type AttachmentOwner,
} from "@/lib/attachments.server";

export type AttachmentFormState = { error: string | null; ok: string | null; savedAt?: number };

const KINDS: AttachmentKind[] = ["expense_bill", "client_agreement", "vat_bill", "company_bill"];

const OWNER_TABLE: Record<AttachmentKind, string> = {
  expense_bill: "public.expenses",
  client_agreement: "public.income_agreements",
  vat_bill: "public.income_payments",
  company_bill: "public.company_bills",
};

function revalidateFor(kind: AttachmentKind) {
  if (kind === "expense_bill") {
    revalidatePath("/expenses");
    return;
  }
  if (kind === "company_bill") {
    revalidatePath("/vat");
    revalidatePath("/bills");
    return;
  }
  revalidatePath("/income");
  revalidatePath("/income/[id]", "page");
  revalidatePath("/clients");
  revalidatePath("/vat");
}

/**
 * Add files to an existing record on their own — e.g. the signed agreement
 * pages of a client that was added before uploads existed.
 */
export async function uploadAttachments(
  _previous: AttachmentFormState,
  formData: FormData
): Promise<AttachmentFormState> {
  try {
    const session = await requireSession();
    assertAppOwner(session);
    const kind = String(formData.get("kind") ?? "") as AttachmentKind;
    const ownerId = String(formData.get("owner_id") ?? "");
    if (!KINDS.includes(kind) || !ownerId) return { error: "Nothing to attach these files to.", ok: null };

    const exists = await one(`select 1 from ${OWNER_TABLE[kind]} where id = $1`, [ownerId]);
    if (!exists) return { error: "That record no longer exists.", ok: null };

    const uploads = await readUploads(formData, "files");
    if (uploads.length === 0) return { error: "Choose at least one file.", ok: null };
    const owner = { kind, id: ownerId } as AttachmentOwner;
    await assertRoomFor(owner, uploads.length);
    await transaction((client) => insertAttachments(client, owner, uploads, session.sub));

    revalidateFor(kind);
    return {
      error: null,
      ok: `${uploads.length} file${uploads.length === 1 ? "" : "s"} saved.`,
      savedAt: Date.now(),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the files.", ok: null };
  }
}

/** VAT bills for one or more of a client's payments, from the client page. */
export async function uploadClientVatBills(
  _previous: AttachmentFormState,
  formData: FormData
): Promise<AttachmentFormState> {
  try {
    const session = await requireSession();
    assertAppOwner(session);
    const agreementId = String(formData.get("agreement_id") ?? "");
    if (!agreementId) return { error: "Client not found.", ok: null };
    const byPayment = await readClientVatBills(formData, agreementId);
    const count = [...byPayment.values()].reduce((sum, uploads) => sum + uploads.length, 0);
    if (count === 0) return { error: "Choose at least one VAT bill.", ok: null };
    await transaction((client) => insertClientVatBills(client, byPayment, session.sub));
    revalidateFor("vat_bill");
    return { error: null, ok: `${count} VAT bill file${count === 1 ? "" : "s"} saved.`, savedAt: Date.now() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the VAT bills.", ok: null };
  }
}

/** Remove one file. The record it belonged to is untouched. */
export async function deleteAttachment(id: string): Promise<{ error: string | null }> {
  try {
    const session = await requireSession();
    assertAppOwner(session);
    const row = await one<{ kind: AttachmentKind }>(
      `select kind from public.attachments where id = $1`,
      [id]
    );
    if (!row) return { error: null };
    await exec(`delete from public.attachments where id = $1`, [id]);
    revalidateFor(row.kind);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not remove the file." };
  }
}
