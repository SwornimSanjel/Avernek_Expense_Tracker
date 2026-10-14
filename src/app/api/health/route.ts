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
 * Which database this container is pointed at — host and name only, never the
 * credentials. Reported so "is it talking to the right database?" is answerable
 * without shelling into the container.
 *
 * Parsed defensively rather than through lib/db, which throws on bad input:
 * liveness must not depend on configuration being correct, or a typo in
 * DATABASE_URL turns into a Docker restart loop.
 */
function databaseTarget(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return "UNSET";
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return "INVALID";
  }
}

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "avernek-expense-tracker",
    database: databaseTarget(),
    time: new Date().toISOString(),
  });
}
