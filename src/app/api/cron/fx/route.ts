import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchNrbUsd, cacheNrbUsd } from "@/lib/fx";
import { format, subDays } from "date-fns";

/**
 * Daily job: pull the last few days of NRB USD rates and cache them.
 * Scheduled by the hosting platform. Protected by CRON_SECRET so it
 * can't be triggered by strangers. NEVER call NRB on page load — only here.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const to = format(new Date(), "yyyy-MM-dd");
  const from = format(subDays(new Date(), 5), "yyyy-MM-dd");

  try {
    const rows = await fetchNrbUsd(from, to);
    const supabase = createServiceClient();
    await cacheNrbUsd(supabase, rows);
    return NextResponse.json({ ok: true, cached: rows.length, from, to });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 }
    );
  }
}
