import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import {
  FULL_ACCESS,
  canView,
  canViewExpenses,
  firstAllowedHref,
  resolveAccess,
  type Access,
  type SectionKey,
} from "@/lib/access";
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

/** A signed-in person as the database sees them right now. */
export type CurrentUser = Session & { access: Access };

async function cookieSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/**
 * The signed-in user, or null.
 *
 * The cookie proves who they are; the database says whether they still have
 * access and what they may view. It is read on every request (once per
 * request, through cache), so removing someone or changing what they see
 * takes effect at once rather than when their seven-day cookie runs out. The
 * admin flag comes from the database too, not from the cookie's copy.
 */
export const getSession = cache(async (): Promise<CurrentUser | null> => {
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
      access: FULL_ACCESS,
    };
  }

  const session = await cookieSession();
  if (!session) return null;

  const account = await readAccount(session.sub);
  if (!account || account.removed_at) return null;

  return {
    ...session,
    name: account.name,
    email: account.email,
    isAdmin: account.is_admin,
    access: resolveAccess(account),
  };
});

type Account = { name: string; email: string; is_admin: boolean; access: unknown; removed_at: string | null };

/**
 * access and removed_at are read through to_jsonb(u), which gives null for a
 * column that does not exist yet. Deployed before
 * db/migrations/20261030_user_access_and_safe_removal.sql, everyone simply
 * keeps signing in as before (no view limits, no removals) instead of every
 * page failing.
 */
function readAccount(id: string): Promise<Account | null> {
  return one<Account>(
    `select u.name, u.email, u.is_admin,
            to_jsonb(u) -> 'access' as access,
            to_jsonb(u) ->> 'removed_at' as removed_at
       from public.users u
      where u.id = $1`,
    [id]
  );
}

/** The signed-in user, or redirect to /login. */
export async function requireSession(): Promise<CurrentUser> {
  const session = await getSession();
  if (session) return session;
  // A valid cookie for someone whose access was removed: clear it first, or
  // the login page would send them straight back here.
  if (await cookieSession()) redirect("/signed-out");
  redirect("/login");
}

/** The signed-in user if they may view this page; otherwise their first page. */
export async function requireSection(section: SectionKey): Promise<CurrentUser> {
  const session = await requireSession();
  if (!canView(session.access, section)) redirect(firstAllowedHref(session.access));
  return session;
}

/** The signed-in user if they may view any expenses; otherwise their first page. */
export async function requireExpenseAccess(): Promise<CurrentUser> {
  const session = await requireSession();
  if (!canViewExpenses(session.access)) redirect(firstAllowedHref(session.access));
  return session;
}

/**
 * The signed-in admin, or throw.
 *
 * Throws rather than redirects: this guards mutations, and a redirect would
 * make a rejected write look like it succeeded.
 */
export async function requireAdmin(): Promise<CurrentUser> {
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
