"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAppOwner } from "@/lib/authz";

async function createOwnerClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  assertAppOwner(user?.email);
  return { supabase, user: user! };
}

export async function addCategory(formData: FormData) {
  const { supabase } = await createOwnerClient();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;
  const budget = formData.get("monthly_budget");
  await supabase.from("categories").insert({
    name,
    color: (formData.get("color") as string) || "#1e3a5f",
    monthly_budget: budget ? Number(budget) : null,
  });
  revalidatePath("/settings");
}

export async function setBudget(id: string, budget: number | null) {
  const { supabase } = await createOwnerClient();
  await supabase.from("categories").update({ monthly_budget: budget }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function updateMyName(formData: FormData) {
  const { supabase, user } = await createOwnerClient();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;
  await supabase.from("users").update({ name }).eq("id", user.id);
  revalidatePath("/", "layout");
}

export async function setCoreMember(id: string, value: boolean) {
  const { supabase } = await createOwnerClient();
  await supabase.from("users").update({ is_core_member: value }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/settlements");
}
