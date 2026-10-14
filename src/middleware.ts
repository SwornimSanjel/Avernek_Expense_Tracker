import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isAuthBypassEnabled } from "@/lib/auth/bypass";

/**
 * Gates every request on the signed session cookie.
 *
 * Verification is a single HMAC check — no database query and no call to an
 * external auth service — so this costs effectively nothing per request and
 * cannot redirect anywhere off this site.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (isAuthBypassEnabled()) {
    if (path.startsWith("/login")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/api/cron") ||
    // Container healthcheck and deploy smoke test. Must answer without a session.
    path === "/api/health";

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic) {
    // No reason to show a sign-in form to someone already signed in.
    if (session && path.startsWith("/login")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Remember the destination so sign-in returns there instead of the dashboard.
    if (path !== "/") url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
