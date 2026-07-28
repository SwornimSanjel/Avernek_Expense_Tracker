import { NextResponse } from "next/server";

/**
 * Liveness probe for the Docker HEALTHCHECK and the Jenkins deploy smoke test.
 *
 * Deliberately does NOT touch Supabase: a database blip should not make the
 * container look dead and send Docker into a restart loop. This answers
 * "is the Next.js server up and serving?" and nothing more.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "avernek-expense-tracker",
    time: new Date().toISOString(),
  });
}
