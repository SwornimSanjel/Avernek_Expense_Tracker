import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * GET /signed-out — where requireSession sends someone whose cookie is still
 * valid but whose access was removed. Pages cannot clear a cookie, so this
 * route does, then shows the sign-in page with a short explanation.
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?removed=1", request.url));
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
