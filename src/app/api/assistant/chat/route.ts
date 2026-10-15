import { z } from "zod";
import { runChat } from "@/lib/ai/agent";
import { guard, json, readJson } from "@/lib/ai/http";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { LIMITS } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  message: z.string().trim().min(1).max(LIMITS.messageChars),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(40)
    .default([]),
  context: z
    .object({
      client: z.string().max(120).optional(),
      lastRecord: z
        .object({ kind: z.enum(["expense", "payment"]), id: z.string().uuid(), label: z.string().max(200) })
        .optional(),
    })
    .default({}),
});

/** A chat message: the model picks tools, the server runs them. */
export async function POST(request: Request) {
  const guarded = await guard(request, { needsModel: true });
  if (guarded instanceof Response) return guarded;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return json({ error: "Please write a message (up to 1,500 characters)." }, 400);

  try {
    return json(await runChat(parsed.data, guarded.ctx, guarded.deps));
  } catch (error) {
    if (error instanceof OpenRouterError) {
      console.error("[ai chat]", error.message);
      return json({ error: "The AI service is not answering right now. Try again in a moment." }, 502);
    }
    console.error("[ai chat]", error);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
