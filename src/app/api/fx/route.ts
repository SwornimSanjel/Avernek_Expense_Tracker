import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUsdSellRateForDate } from "@/lib/fx";

// GET /api/fx?date=YYYY-MM-DD  ->  { rate, rateDate } | { rate: null }
// Used by the add-expense form to preview the NRB rate as the user types.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const date =
    request.nextUrl.searchParams.get("date") ||
    new Date().toISOString().slice(0, 10);
  const rate = await getUsdSellRateForDate(supabase, date);
  return NextResponse.json(rate ?? { rate: null });
}
