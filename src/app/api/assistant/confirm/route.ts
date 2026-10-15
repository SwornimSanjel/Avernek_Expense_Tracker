import { z } from "zod";
import { runConfirm } from "@/lib/ai/agent";
import { guard, json, readJson } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  draftId: z.string().uuid(),
  decision: z.enum(["confirm", "cancel"]),
});

/** Confirm or cancel a prepared change: the only route that writes to the books. */
export async function POST(request: Request) {
  const guarded = await guard(request, { needsModel: false });
  if (guarded instanceof Response) return guarded;
  const raw = await readJson(request, 4 * 1024);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return json({ error: "Invalid confirmation." }, 400);

  try {
    return json(await runConfirm(parsed.data, guarded.ctx, guarded.deps));
  } catch (error) {
    console.error("[ai confirm]", error);
    return json({ error: "Something went wrong. Check the page before trying again." }, 500);
  }
}
