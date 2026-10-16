import { exec, one } from "@/lib/db";

/**
 * Persistence for the assistant: drafts awaiting confirmation and the audit
 * log (db/migrations/20261015_ai_assistant.sql).
 */

export type AuditEntry = {
  userId: string | null;
  kind: "chat" | "tool" | "form" | "confirm" | "transcription" | "receipt";
  tool?: string | null;
  status: "ok" | "needs_input" | "needs_choice" | "denied" | "error" | "cancelled";
  detail?: Record<string, unknown> | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
};

/** Records one event. Never throws: a logging failure must not fail the request. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await exec(
      `insert into public.ai_audit_log
         (user_id, kind, tool, status, detail, model, prompt_tokens, completion_tokens, cost_usd, latency_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.userId,
        entry.kind,
        entry.tool ?? null,
        entry.status,
        entry.detail ? JSON.stringify(entry.detail).slice(0, 20_000) : null,
        entry.model ?? null,
        entry.promptTokens ?? null,
        entry.completionTokens ?? null,
        entry.costUsd ?? null,
        entry.latencyMs ?? null,
      ]
    );
  } catch (error) {
    console.error("[ai audit] could not record:", error instanceof Error ? error.message : error);
  }
}

export type Draft = {
  id: string;
  user_id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: Record<string, unknown>;
  status: "pending" | "executing" | "done" | "failed" | "cancelled";
  expires_at: string;
};

export async function createDraft(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  summary: Record<string, unknown>
): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into public.ai_pending_actions (user_id, tool, args, summary)
     values ($1, $2, $3, $4) returning id`,
    [userId, tool, JSON.stringify(args), JSON.stringify(summary)]
  );
  if (!row) throw new Error("Could not store the draft.");
  return row.id;
}

/**
 * Takes a pending draft for execution. One statement moves it from pending to
 * executing, so of two concurrent confirmations only one gets the row: this is
 * the idempotency guarantee. Only the person who asked can claim it.
 */
export async function claimDraft(id: string, userId: string): Promise<Draft | null> {
  return one<Draft>(
    `update public.ai_pending_actions
        set status = 'executing', decided_at = now()
      where id = $1 and user_id = $2 and status = 'pending' and expires_at > now()
      returning id, user_id, tool, args, summary, status, expires_at`,
    [id, userId]
  );
}

/** Why a draft could not be claimed: already done, cancelled, expired or unknown. */
export async function draftState(id: string, userId: string): Promise<string> {
  const row = await one<{ status: Draft["status"]; expired: boolean }>(
    `select status, expires_at <= now() as expired from public.ai_pending_actions where id = $1 and user_id = $2`,
    [id, userId]
  );
  if (!row) return "not found";
  if (row.status === "pending" && row.expired) return "expired";
  return row.status;
}

export async function finishDraft(id: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }) {
  await exec(
    `update public.ai_pending_actions set status = $2, result = $3, error = $4 where id = $1`,
    [id, outcome.ok ? "done" : "failed", outcome.ok ? JSON.stringify(outcome.result ?? null) : null, outcome.ok ? null : outcome.error]
  );
}

export async function cancelDraft(id: string, userId: string): Promise<boolean> {
  const changed = await exec(
    `update public.ai_pending_actions set status = 'cancelled', decided_at = now()
      where id = $1 and user_id = $2 and status = 'pending'`,
    [id, userId]
  );
  return changed > 0;
}
