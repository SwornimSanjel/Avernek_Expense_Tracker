"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAppOwner } from "@/lib/authz";

export async function recordSettlement(formData: FormData) {
  const supabase = await createClient();
  const from = formData.get("from_user_id") as string;
  const to = formData.get("to_user_id") as string;
  const amount = Number(formData.get("amount_npr"));
  if (!from || !to || from === to || !(amount > 0)) return;

  const { error } = await supabase.from("settlements").insert({
    from_user_id: from,
    to_user_id: to,
    amount_npr: amount,
    note: (formData.get("note") as string) || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settlements");
}

export async function updateSettlement(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  assertAppOwner(user?.email);
  const id = String(formData.get("settlement_id") ?? "");
  const from = String(formData.get("from_user_id") ?? "");
  const to = String(formData.get("to_user_id") ?? "");
  const amount = Number(formData.get("amount_npr"));
  if (!id || !from || !to || from === to || !(amount > 0)) {
    return { error: "Choose two different people and enter a valid amount." };
  }
  const { error } = await supabase
    .from("settlements")
    .update({
      from_user_id: from,
      to_user_id: to,
      amount_npr: amount,
      settled_on:
        String(formData.get("settled_on") ?? "") || new Date().toISOString().slice(0, 10),
      note: String(formData.get("note") ?? "") || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settlements");
  return { error: null };
}

export async function deleteSettlement(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  assertAppOwner(user?.email);
  const { error } = await supabase.from("settlements").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settlements");
  return { error: null };
}
