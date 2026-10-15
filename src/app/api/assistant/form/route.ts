import { z } from "zod";
import { runForm } from "@/lib/ai/agent";
import { guard, json, readJson } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const value = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.string().max(200)).max(20)]);
const body = z.object({
  tool: z.string().max(64),
  values: z.record(z.string().max(64), value).refine((values) => Object.keys(values).length <= 60, "Too many fields"),
});

/** A submitted form or choice. Needs no model call, so it works even if OpenRouter is down. */
export async function POST(request: Request) {
  const guarded = await guard(request, { needsModel: false });
  if (guarded instanceof Response) return guarded;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return json({ error: "That form could not be read. Ask again." }, 400);

  try {
    return json(await runForm(parsed.data, guarded.ctx, guarded.deps));
  } catch (error) {
    console.error("[ai form]", error);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
