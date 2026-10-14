"use server";

import { revalidatePath } from "next/cache";
import { exec, one } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import { hashPassword, validatePassword } from "@/lib/auth/password";

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

/**
 * Result of the two team-management forms. `ok` carries a confirmation rather
 * than redirecting, because the admin usually adds several people in a row.
 */
export type MemberState = { error: string | null; ok: string | null };

/**
 * Add someone to the team.
 *
 * A member with no password is a participant: they appear in payer lists and
 * splits but cannot sign in. Giving them a password turns the same row into a
 * login account — there is no separate accounts table.
 */
export async function addMember(
  _previous: MemberState,
  formData: FormData
): Promise<MemberState> {
  await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const isAdmin = formData.get("is_admin") === "on";
  const isCore = formData.get("is_core_member") === "on";

  if (!name) return { error: "Enter a name.", ok: null };
  if (!email) return { error: "Enter an email address.", ok: null };

  let passwordHash: string | null = null;

  if (password) {
    const problem = validatePassword(password);
    if (problem) return { error: problem, ok: null };
    passwordHash = await hashPassword(password);
  } else if (isAdmin) {
    return {
      error: "An administrator needs a password to sign in with.",
      ok: null,
    };
  }

  try {
    await exec(
      `insert into public.users (name, email, password_hash, is_admin, is_core_member)
       values ($1, $2, $3, $4, $5)`,
      [name, email, passwordHash, isAdmin, isCore]
    );
  } catch (error) {
    // users_email_lower_key. Checking first and inserting after would still
    // race, so the constraint is the real guard and this just translates it.
    if (String(error).includes("users_email_lower_key")) {
      return { error: `${email} is already on the team.`, ok: null };
    }
    throw error;
  }

  revalidatePath("/settings");
  revalidatePath("/settlements");
  revalidatePath("/expenses");

  return {
    error: null,
    ok: passwordHash
      ? `${name} added. They can sign in as ${email}.`
      : `${name} added as a participant. No password, so they cannot sign in yet.`,
  };
}

/**
 * Set or replace a member's password, which is also how an existing
 * participant is given a login for the first time.
 *
 * Note: this does not sign the member out anywhere. Sessions are signed with
 * SESSION_SECRET and carry no password material, so an already-issued cookie
 * stays valid until it expires.
 */
export async function setMemberPassword(
  _previous: MemberState,
  formData: FormData
): Promise<MemberState> {
  await requireOwner();

  const id = String(formData.get("member_id") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!id) return { error: "Choose a member.", ok: null };

  const problem = validatePassword(password);
  if (problem) return { error: problem, ok: null };

  const member = await one<{ name: string; email: string }>(
    `select name, email from public.users where id = $1`,
    [id]
  );

  if (!member) return { error: "That member no longer exists.", ok: null };

  await exec(`update public.users set password_hash = $1 where id = $2`, [
    await hashPassword(password),
    id,
  ]);

  revalidatePath("/settings");

  return {
    error: null,
    ok: `Password set. ${member.name} signs in as ${member.email}.`,
  };
}
