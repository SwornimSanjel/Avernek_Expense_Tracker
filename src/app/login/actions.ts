"use server";

import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/server";

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  is_admin: boolean;
};

export type LoginState = { error: string | null };

/** Only same-site absolute paths, so `next` cannot be turned into an open redirect. */
function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function signIn(
  _previous: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  let user: UserRow | null;
  try {
    user = await one<UserRow>(
      `select id, name, email, password_hash, is_admin
         from public.users
        where lower(email) = $1
        limit 1`,
      [email]
    );
  } catch (error) {
    console.error("[login] database error:", error);
    return { error: "Cannot reach the database. Try again in a moment." };
  }

  // Verify even when the user is absent, against a hash that cannot match. A
  // fast "no such user" versus a slow "wrong password" is enough to enumerate
  // which addresses have accounts.
  const valid = await verifyPassword(
    password,
    user?.password_hash ?? "scrypt$00$00"
  );

  // One message for both cases, for the same reason.
  if (!user || !valid) {
    return { error: "Incorrect email or password." };
  }

  await setSessionCookie({
    sub: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
  });

  // Best-effort: a failure here must not block a valid sign-in.
  try {
    await one(`update public.users set last_login_at = now() where id = $1 returning id`, [
      user.id,
    ]);
  } catch (error) {
    console.error("[login] could not record last_login_at:", error);
  }

  redirect(next);
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
