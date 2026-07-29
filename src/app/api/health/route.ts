import { NextResponse } from "next/server";

/**
 * Liveness probe for the Docker HEALTHCHECK and the Jenkins deploy smoke test.
 *
 * Deliberately does NOT touch Supabase: a database blip should not make the
 * container look dead and send Docker into a restart loop. This answers
 * "is the Next.js server up and serving?" and nothing more.
 */
export const dynamic = "force-dynamic";

/**
 * Which Supabase project THIS BUILD talks to.
 *
 * Reported because NEXT_PUBLIC_* is compiled into the bundle, so .env can say
 * one thing while the running container says another — and the only visible
 * symptom is sign-ins going somewhere unexpected. Host only: no keys.
 *
 * Read straight from the environment rather than through lib/supabase/config,
 * which throws on bad input. Liveness must not depend on configuration being
 * correct, or a typo turns into a Docker restart loop.
 */
function supabaseTarget(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return "UNSET";
  try {
    return new URL(raw).host;
  } catch {
    return `INVALID(${raw})`;
  }
}

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "avernek-expense-tracker",
    supabase: supabaseTarget(),
    time: new Date().toISOString(),
  });
}
