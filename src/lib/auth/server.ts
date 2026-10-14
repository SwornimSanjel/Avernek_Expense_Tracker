import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { isAuthBypassEnabled } from "./bypass";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type Session,
} from "./session";

/**
 * Session helpers for Server Components, Route Handlers and Server Actions.
 *
 * Middleware already blocks unauthenticated requests, but every one of these
 * re-checks rather than assuming. Middleware runs on a path matcher, and a
 * matcher edit should never silently become a data leak.
 */

/** The signed-in user, or null. */
export async function getSession(): Promise<Session | null> {
  if (isAuthBypassEnabled()) {
    const admin = await one<{
      id: string;
      email: string;
      name: string;
      is_admin: boolean;
    }>(
      `select id, email, name, is_admin
         from public.users
        where is_admin = true
        order by last_login_at desc nulls last, id
        limit 1`
    );

    if (!admin) {
      throw new Error(
        "AUTH_BYPASS is enabled, but the database has no administrator account."
      );
    }

    return {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      isAdmin: true,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    };
  }

  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in user, or redirect to /login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * The signed-in admin, or throw.
 *
 * Throws rather than redirects: this guards mutations, and a redirect would
 * make a rejected write look like it succeeded.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!session.isAdmin) {
    throw new Error("Only an administrator can perform this action.");
  }
  return session;
}

export async function setSessionCookie(
  session: Omit<Session, "exp">
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(session), {
    httpOnly: true, // not readable by JavaScript, so XSS cannot exfiltrate it
    sameSite: "lax", // survives top-level navigation, blocks cross-site POSTs
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
