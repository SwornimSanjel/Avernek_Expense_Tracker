"use server";

import { revalidatePath } from "next/cache";
import { exec } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";

export async function recordSettlement(formData: FormData) {
  await requireSession();

  const from = formData.get("from_user_id") as string;
  const to = formData.get("to_user_id") as string;
  const amount = Number(formData.get("amount_npr"));
  if (!from || !to || from === to || !(amount > 0)) return;

  await exec(
    `insert into public.settlements (from_user_id, to_user_id, amount_npr, note)
     values ($1, $2, $3, $4)`,
    [from, to, amount, (formData.get("note") as string) || null]
  );

  revalidatePath("/settlements");
}

export async function updateSettlement(formData: FormData) {
  const session = await requireSession();
  assertAppOwner(session);

  const id = String(formData.get("settlement_id") ?? "");
  const from = String(formData.get("from_user_id") ?? "");
  const to = String(formData.get("to_user_id") ?? "");
  const amount = Number(formData.get("amount_npr"));

  if (!id || !from || !to || from === to || !(amount > 0)) {
    return { error: "Choose two different people and enter a valid amount." };
  }

  try {
    await exec(
      `update public.settlements
          set from_user_id = $1,
              to_user_id   = $2,
              amount_npr   = $3,
              settled_on   = $4,
              note         = $5
        where id = $6`,
      [
        from,
        to,
        amount,
        String(formData.get("settled_on") ?? "") ||
          new Date().toISOString().slice(0, 10),
        String(formData.get("note") ?? "") || null,
        id,
      ]
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Update failed." };
  }

  revalidatePath("/settlements");
  return { error: null };
}

export async function deleteSettlement(id: string) {
  const session = await requireSession();
  assertAppOwner(session);

  try {
    await exec(`delete from public.settlements where id = $1`, [id]);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Delete failed." };
  }

  revalidatePath("/settlements");
  return { error: null };
}
