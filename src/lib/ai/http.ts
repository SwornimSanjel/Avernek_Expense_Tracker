import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";
import { hasEverything } from "@/lib/access";
import { one } from "@/lib/db";
import { todayIso } from "@/lib/income";
import type { AgentDeps } from "./agent";
import { aiConfig, type AiConfig } from "./config";
import { RequestData } from "./data";
import { chat } from "./openrouter";
import { audit, cancelDraft, claimDraft, createDraft, draftState, finishDraft } from "./store";
import type { ToolContext } from "./tools/types";

/**
 * The guard every assistant endpoint passes through: same-origin request,
 * signed-in session, and the person's current admin flag read from the
 * database (the session cookie's copy is only as fresh as the last sign-in).
 */

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type Guarded = { ctx: ToolContext; deps: AgentDeps; config: AiConfig | null };

export async function guard(request: Request, { needsModel }: { needsModel: boolean }): Promise<Guarded | Response> {
  // Browsers send Origin on every POST; a different one means another site is
  // making this request with the person's cookie.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // "null" (a sandboxed page) or garbage: not this site.
    }
    if (originHost !== host) return json({ error: "Cross-site request refused." }, 403);
  }

  const session = await getSession();
  if (!session) return json({ error: "Your session has ended. Sign in again." }, 401);
  const user = await one<{ name: string; is_admin: boolean }>(`select name, is_admin from public.users where id = $1`, [
    session.sub,
  ]);
  if (!user) return json({ error: "Your account no longer exists." }, 401);
  // The assistant can read every table, so only people who may see everything get it.
  if (!hasEverything(session.access)) return json({ error: "Ask AI is not available on your account." }, 403);

  const config = aiConfig();
  if (needsModel && !config) {
    return json({ error: "The assistant is not configured on this server (OPENROUTER_API_KEY is missing)." }, 503);
  }

  const today = todayIso();
  const ctx: ToolContext = {
    session: { ...session, name: user.name, isAdmin: user.is_admin === true },
    today,
    data: new RequestData(today),
  };
  const deps: AgentDeps = {
    chat: (chatRequest) => {
      if (!config) throw new Error("The assistant is not configured.");
      return chat(config, chatRequest);
    },
    audit,
    createDraft,
    claimDraft,
    finishDraft,
    cancelDraft,
    draftState,
  };
  return { ctx, deps, config };
}

/** Reads a JSON body of at most `limit` bytes. */
export async function readJson(request: Request, limit = 64 * 1024): Promise<unknown | Response> {
  const text = await request.text();
  if (text.length > limit) return json({ error: "Request too large." }, 413);
  try {
    return JSON.parse(text);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
}
