"use server";

import { revalidatePath } from "next/cache";
import { exec } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";

/**
 * Every mutation re-checks admin rights. With the RLS policies gone these
 * checks are the only thing standing between a signed-in team member and the
 * protected settings, so none of them may be skipped.
 */
async function requireOwner() {
  const session = await requireSession();
  assertAppOwner(session);
  return session;
}

export async function addCategory(formData: FormData) {
  await requireOwner();

  const name = (formData.get("name") as string)?.trim();
  if (!name) return;

  const budget = formData.get("monthly_budget");

  await exec(
    `insert into public.categories (name, color, monthly_budget)
     values ($1, $2, $3)`,
    [
      name,
      (formData.get("color") as string) || "#1e3a5f",
      budget ? Number(budget) : null,
    ]
  );

  revalidatePath("/settings");
}

export async function setBudget(id: string, budget: number | null) {
  await requireOwner();

  await exec(`update public.categories set monthly_budget = $1 where id = $2`, [
    budget,
    id,
  ]);

  revalidatePath("/settings");
  revalidatePath("/");
}

export async function updateMyName(formData: FormData) {
  const session = await requireOwner();

  const name = (formData.get("name") as string)?.trim();
  if (!name) return;

  await exec(`update public.users set name = $1 where id = $2`, [
    name,
    session.sub,
  ]);

  revalidatePath("/", "layout");
}

export async function setCoreMember(id: string, value: boolean) {
  await requireOwner();

  await exec(`update public.users set is_core_member = $1 where id = $2`, [
    value,
    id,
  ]);

  revalidatePath("/settings");
  revalidatePath("/settlements");
}
