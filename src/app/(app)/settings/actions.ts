"use server";

import { revalidatePath } from "next/cache";
import { exec, one } from "@/lib/db";
import { requireSession } from "@/lib/auth/server";
import { assertAppOwner } from "@/lib/authz";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { EXPENSE_LEDGERS, SECTIONS, storedAccess, type ExpenseLedger, type SectionKey } from "@/lib/access";

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
 * Partners are the people whose money is tracked: they appear in rankings,
 * investment totals and payer / split pickers. Turning it off hides a person
 * from those lists without touching any amount they paid or were split into.
 */
export async function setPartner(id: string, value: boolean) {
  await requireOwner();

  await exec(`update public.users set is_partner = $1 where id = $2`, [value, id]);

  for (const path of ["/settings", "/settlements", "/expenses", "/subscriptions", "/income", "/"]) {
    revalidatePath(path);
  }
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
  const isPartner = formData.get("is_partner") === "on";

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
      `insert into public.users (name, email, password_hash, is_admin, is_core_member, is_partner)
       values ($1, $2, $3, $4, $5, $6)`,
      [name, email, passwordHash, isAdmin, isCore, isPartner]
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

/** Every page whose content depends on who is looking. */
function revalidateAccess() {
  revalidatePath("/", "layout");
}

/**
 * What one person may view: the pages they may open and which kinds of
 * expenses they see (lib/access.ts). Everything ticked is stored as null, the
 * same as never having been limited. Administrators always see everything.
 */
export async function setMemberAccess(id: string, sections: string[], expenses: string[]): Promise<MemberState> {
  await requireOwner();

  const member = await one<{ name: string; is_admin: boolean }>(
    `select name, is_admin from public.users where id = $1`,
    [id]
  );
  if (!member) return { error: "That person no longer exists.", ok: null };
  if (member.is_admin) return { error: "Administrators always see everything.", ok: null };

  const pages = SECTIONS.map((section) => section.key).filter((key): key is SectionKey => sections.includes(key));
  const ledgers = EXPENSE_LEDGERS.filter((key): key is ExpenseLedger => expenses.includes(key));
  const access = storedAccess(pages, ledgers);

  await exec(`update public.users set access = $1::jsonb where id = $2`, [access ? JSON.stringify(access) : null, id]);
  revalidateAccess();
  return { error: null, ok: `Saved. ${member.name} now sees only what is ticked.` };
}

/**
 * Remove someone: they can no longer sign in, and an open session ends on its
 * next page load. Nothing else changes — their row stays, so every expense
 * they paid, every split, contribution and investment that names them still
 * counts exactly as before. Deleting the row is refused by the database for
 * anyone with history (db/migrations/20261030_user_access_and_safe_removal.sql).
 */
export async function removeMember(id: string): Promise<MemberState> {
  const session = await requireOwner();
  if (id === session.sub) return { error: "You cannot remove yourself.", ok: null };

  const member = await one<{ name: string }>(
    `update public.users set removed_at = coalesce(removed_at, now()) where id = $1 returning name`,
    [id]
  );
  if (!member) return { error: "That person no longer exists.", ok: null };

  revalidateAccess();
  return {
    error: null,
    ok: `${member.name} can no longer sign in. Everything they paid, invested or were split into stays as it is.`,
  };
}

/** Give a removed person their sign-in back, with the same password and view limits as before. */
export async function restoreMember(id: string): Promise<MemberState> {
  await requireOwner();

  const member = await one<{ name: string }>(
    `update public.users set removed_at = null where id = $1 returning name`,
    [id]
  );
  if (!member) return { error: "That person no longer exists.", ok: null };

  revalidateAccess();
  return { error: null, ok: `${member.name} can sign in again.` };
}
