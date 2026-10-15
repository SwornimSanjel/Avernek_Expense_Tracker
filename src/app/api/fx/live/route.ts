import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";
import { getLiveUsdNpr } from "@/lib/market-fx";

export const dynamic = "force-dynamic";

// GET /api/fx/live -> the cached live USD/NPR market rate (see lib/market-fx).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rate = await getLiveUsdNpr();
  return NextResponse.json(rate ?? { rate: null }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
