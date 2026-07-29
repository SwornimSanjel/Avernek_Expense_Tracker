import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Completes sign-in and drops the user on the dashboard.
//
// Supabase hands us the credential in one of two shapes and the difference is
// not obvious from the dashboard:
//
//   * OAuth (Google)  -> ?code=...              -> exchangeCodeForSession
//   * Email link      -> ?token_hash=...&type=  -> verifyOtp
//
// Handling only `code` silently bounces every magic link back to /login, which
// looks to the user like the link did nothing at all. Handle both, and when
// something does go wrong send the reason to /login instead of swallowing it.

const EMAIL_OTP_TYPES = new Set<string>([
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
  "email",
]);

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && EMAIL_OTP_TYPES.has(value);
}

/**
 * The public origin of this request.
 *
 * Compose publishes on loopback behind nginx/Caddy, so `request.url` carries
 * the internal 127.0.0.1:PORT origin. Redirecting to that would send the user
 * somewhere their browser cannot reach, so prefer what the proxy reports.
 */
function publicOrigin(request: NextRequest, fallback: string): string {
  const host = request.headers.get("x-forwarded-host");
  if (!host) return fallback;

  const proto =
    request.headers.get("x-forwarded-proto") ??
    new URL(fallback).protocol.replace(":", "");

  return `${proto}://${host}`;
}

/** Only same-site absolute paths, so `next` cannot be used as an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function backToLogin(origin: string, reason: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const base = publicOrigin(request, origin);
  const next = safeNext(searchParams.get("next"));

  // Supabase reports provider-side failures (expired link, denied consent) as
  // query params rather than as a thrown error.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return backToLogin(base, providerError);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await createClient();

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${base}${next}`);
    return backToLogin(base, error.message);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${next}`);
    return backToLogin(base, error.message);
  }

  return backToLogin(
    base,
    "That sign-in link carried no verification code. It was probably already used, or it expired — request a new one."
  );
}
