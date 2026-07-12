"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addCategory(formData: FormData) {
  const supabase = await createClient();
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
  const supabase = await createClient();
  await supabase.from("categories").update({ monthly_budget: budget }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function updateMyName(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const name = (formData.get("name") as string)?.trim();
  if (!name) return;
  await supabase.from("users").update({ name }).eq("id", user.id);
  revalidatePath("/", "layout");
}

export async function setCoreMember(id: string, value: boolean) {
  const supabase = await createClient();
  await supabase.from("users").update({ is_core_member: value }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/settlements");
}
