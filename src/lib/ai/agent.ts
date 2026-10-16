import type { ChatMessage, ChatRequest, ChatResult, ToolCall } from "./openrouter";
import { contextPrompt, SYSTEM_PROMPT } from "./prompt";
import type { AuditEntry, Draft } from "./store";
import { mayUse, toolDefinitions, TOOLS } from "./tools";
import type { Tool, ToolContext, ToolOutcome } from "./tools/types";
import { LIMITS, type AssistantContext, type AssistantReply, type Card, type ChatTurn } from "./types";

/**
 * The assistant's request flow:
 *
 *   1. One model call chooses tools and their arguments (or answers in text).
 *   2. The server validates every argument, checks the person's permission
 *      and runs the tools: predefined, parameterised queries and the app's own
 *      calculations. The model never touches the database.
 *   3. Plain questions are answered from the tools' own summaries and cards,
 *      with no second model call. Only "why/how" questions send the tool
 *      results back for a short explanation.
 *   4. A change to the books comes back as a form (details missing) or a
 *      draft to confirm. It is executed only by runConfirm.
 *
 * Every dependency with side effects is injected, so the flow is unit-tested
 * without a network or a database.
 */

export type AgentDeps = {
  chat: (request: ChatRequest) => Promise<ChatResult>;
  audit: (entry: AuditEntry) => Promise<void>;
  createDraft: (userId: string, tool: string, args: Record<string, unknown>, summary: Record<string, unknown>) => Promise<string>;
  claimDraft: (id: string, userId: string) => Promise<Draft | null>;
  finishDraft: (id: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }) => Promise<void>;
  cancelDraft: (id: string, userId: string) => Promise<boolean>;
  draftState: (id: string, userId: string) => Promise<string>;
  tools?: Tool[];
};

const MAX_TOOL_CALLS = 4;
const FALLBACK =
  "I can help with expenses, subscriptions, clients and their payments, income, VAT and TDS, and account balances, and I can add or correct records for you to confirm.";

type Ran = { call?: ToolCall; tool?: Tool; args: Record<string, unknown>; outcome: ToolOutcome };

export function buildMessages(
  input: { message: string; history: ChatTurn[]; context?: AssistantContext },
  ctx: ToolContext
): ChatMessage[] {
  const history = input.history
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim())
    .slice(-LIMITS.historyTurns)
    .map((turn) => ({ role: turn.role, content: turn.text.slice(0, LIMITS.historyChars) }) as ChatMessage);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: contextPrompt({
        today: ctx.today,
        userName: ctx.session.name || ctx.session.email,
        isAdmin: ctx.session.isAdmin === true,
        context: input.context,
      }),
    },
    ...history,
    { role: "user", content: input.message.slice(0, LIMITS.messageChars) },
  ];
}

function auditStatus(outcome: ToolOutcome): AuditEntry["status"] {
  if (outcome.status === "ready") return "ok";
  return outcome.status;
}

/** Runs one tool for this person: permission first, then the tool, then the audit row. */
async function runTool(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolContext,
  deps: AgentDeps,
  kind: "tool" | "form"
): Promise<ToolOutcome> {
  const started = Date.now();
  let outcome: ToolOutcome;
  if (!mayUse(tool, ctx.session.isAdmin === true)) {
    outcome = {
      status: "denied",
      summary: `Only an administrator can ${tool.label.toLowerCase()}. Ask an administrator to do it, or do it on the relevant page if you have access.`,
    };
  } else {
    try {
      outcome = await tool.run(args, ctx);
    } catch (error) {
      console.error(`[ai tool ${tool.name}]`, error);
      outcome = { status: "error", summary: "Something went wrong while working that out. Please try again." };
    }
  }
  await deps.audit({
    userId: ctx.session.sub,
    kind,
    tool: tool.name,
    status: auditStatus(outcome),
    detail: { args, ...(outcome.status === "ok" ? {} : { summary: outcome.summary }) },
    latencyMs: Date.now() - started,
  });
  return outcome;
}

/** One line per confirmation row, for the conversation history. */
function rowsLine(rows: { label: string; value: string }[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("; ");
}

/** Turns tool outcomes into one reply: cards, a form, or a confirmation. */
async function assemble(ran: Ran[], ctx: ToolContext, deps: AgentDeps): Promise<AssistantReply> {
  const reply: AssistantReply = { text: "", cards: [], steps: [] };
  const texts: string[] = [];
  // What the model will see of this answer next turn: summaries, what was
  // asked for and what is waiting for confirmation.
  const memory: string[] = [];
  for (const { tool, outcome } of ran) {
    if (tool && !reply.steps!.includes(tool.label)) reply.steps!.push(tool.label);
    switch (outcome.status) {
      case "ok":
        reply.cards.push(...outcome.cards);
        texts.push(outcome.summary);
        memory.push(outcome.summary);
        if (outcome.context) reply.context = { ...reply.context, ...outcome.context };
        break;
      case "needs_input":
      case "needs_choice":
        if (!reply.form && !reply.confirm) {
          reply.form = outcome.form;
          texts.push(outcome.summary);
          memory.push(`${outcome.summary} (asked for: ${outcome.form.fields.map((field) => field.label).join(", ")})`);
        }
        break;
      case "ready":
        if (!reply.form && !reply.confirm && tool) {
          const draftId = await deps.createDraft(ctx.session.sub, tool.name, outcome.draft.args, {
            title: outcome.draft.title,
            rows: outcome.draft.rows,
          });
          reply.confirm = {
            draftId,
            tool: tool.name,
            title: outcome.draft.title,
            rows: outcome.draft.rows,
            warnings: outcome.draft.warnings,
            confirmLabel: outcome.draft.confirmLabel,
            values: outcome.draft.args,
          };
          texts.push(outcome.summary);
          memory.push(`Waiting for the user to confirm: ${outcome.draft.title} (${rowsLine(outcome.draft.rows)})`);
        }
        break;
      default:
        // Shown once, as a card; kept in the history so the model knows.
        reply.cards.push({ type: "notice", tone: outcome.status === "denied" ? "warn" : "error", text: outcome.summary });
        memory.push(outcome.summary);
    }
  }
  reply.text = texts.join("\n");
  reply.memory = memory.join("\n");
  return reply;
}

function parseArgs(raw: string | undefined): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function runChat(
  input: { message: string; history: ChatTurn[]; context?: AssistantContext },
  ctx: ToolContext,
  deps: AgentDeps
): Promise<AssistantReply> {
  const tools = deps.tools ?? TOOLS;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = toolDefinitions(tools);
  // Only the arguments a tool declares are passed on: anything else the model
  // invents (a record id, say) is dropped before the tool sees it.
  const declared = new Map(
    definitions.map((definition) => [
      definition.function.name,
      new Set(Object.keys((definition.function.parameters.properties as Record<string, unknown> | undefined) ?? {})),
    ])
  );
  const messages = buildMessages(input, ctx);
  ctx = { ...ctx, conversation: input.context };

  // A pasted list (bills) becomes one long tool call: give it room and time.
  // Ordinary questions are far shorter than 400 characters.
  const long = input.message.length > 400;
  const first = await deps.chat({
    messages,
    tools: definitions,
    toolChoice: "auto",
    maxTokens: long ? 4000 : 500,
    ...(long ? { timeoutMs: 90_000 } : {}),
  });
  await deps.audit({
    userId: ctx.session.sub,
    kind: "chat",
    status: "ok",
    detail: { tools: first.toolCalls.map((call) => call.function.name) },
    model: first.model,
    promptTokens: first.usage.promptTokens,
    completionTokens: first.usage.completionTokens,
    costUsd: first.usage.costUsd,
    latencyMs: first.latencyMs,
  });
  if (!first.toolCalls.length) {
    return { text: first.content?.trim() || FALLBACK, cards: [] };
  }

  const calls = first.toolCalls.slice(0, MAX_TOOL_CALLS);
  const ran: Ran[] = [];
  let write = false;
  for (const call of calls) {
    const tool = byName.get(call.function.name);
    const parsedArgs = parseArgs(call.function.arguments);
    if (!parsedArgs) {
      console.error(`[ai] unreadable arguments for ${call.function.name}:`, String(call.function.arguments ?? "").slice(0, 300));
    }
    const allowed = declared.get(call.function.name);
    const args = parsedArgs && allowed ? Object.fromEntries(Object.entries(parsedArgs).filter(([key]) => allowed.has(key))) : parsedArgs;
    if (!tool) {
      ran.push({ call, args: {}, outcome: { status: "error", summary: "I can't do that here." } });
      continue;
    }
    if (!args) {
      ran.push({ call, tool, args: {}, outcome: { status: "error", summary: "I couldn't understand that request. Could you rephrase it?" } });
      continue;
    }
    if (tool.kind === "write") {
      // One change per message: each one gets its own form and confirmation.
      if (write) continue;
      write = true;
    }
    ran.push({ call, tool, args, outcome: await runTool(tool, args, ctx, deps, "tool") });
  }

  const reply = await assemble(ran, ctx, deps);
  const explain = ran.some(({ outcome, args }) => outcome.status === "ok" && args.explain === true);
  if (explain && !reply.form && !reply.confirm) {
    // Only the tools' compact data goes back, never raw rows.
    const used = ran.filter((item) => item.call);
    const followUp: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: null, tool_calls: used.map((item) => item.call!) },
      ...used.map((item) => ({
        role: "tool" as const,
        tool_call_id: item.call!.id,
        content: JSON.stringify({
          status: item.outcome.status,
          summary: item.outcome.summary,
          data: item.outcome.status === "ok" ? item.outcome.data : undefined,
        }).slice(0, 8000),
      })),
      {
        role: "system",
        content:
          "Explain the user's question in at most 120 words using only the figures in the tool results above. Do not repeat every number; the cards show them. If the data cannot answer it, say what is missing.",
      },
    ];
    try {
      const second = await deps.chat({ messages: followUp, tools: definitions, toolChoice: "none", maxTokens: 400 });
      await deps.audit({
        userId: ctx.session.sub,
        kind: "chat",
        status: "ok",
        detail: { explanation: true },
        model: second.model,
        promptTokens: second.usage.promptTokens,
        completionTokens: second.usage.completionTokens,
        costUsd: second.usage.costUsd,
        latencyMs: second.latencyMs,
      });
      if (second.content?.trim()) {
        reply.text = second.content.trim();
        reply.memory = `${reply.text}\n${reply.memory ?? ""}`.trim();
      }
    } catch (error) {
      // The figures are already in the cards: fall back to their summaries.
      console.error("[ai explain]", error instanceof Error ? error.message : error);
    }
  }
  return reply;
}

/** A submitted form or choice: runs the tool again with everything known so far. */
export async function runForm(
  input: { tool: string; values: Record<string, unknown>; context?: AssistantContext },
  ctx: ToolContext,
  deps: AgentDeps
): Promise<AssistantReply> {
  const tool = (deps.tools ?? TOOLS).find((candidate) => candidate.name === input.tool);
  if (!tool) return { text: "That form is no longer valid. Ask again.", cards: [] };
  ctx = { ...ctx, conversation: input.context };
  const outcome = await runTool(tool, input.values, ctx, deps, "form");
  return assemble([{ tool, args: input.values, outcome }], ctx, deps);
}

const STATE_MESSAGES: Record<string, string> = {
  done: "This was already saved.",
  executing: "This is already being saved.",
  cancelled: "This was cancelled, so nothing was saved. Ask again to prepare it fresh.",
  failed: "This could not be saved earlier. Ask again to prepare it fresh.",
  expired: "This confirmation expired after 15 minutes, so nothing was saved. Ask again to prepare it fresh.",
  "not found": "That confirmation could not be found. Ask again.",
};

/** Confirm or cancel a draft. The only path that changes the books. */
export async function runConfirm(
  input: { draftId: string; decision: "confirm" | "cancel" },
  ctx: ToolContext,
  deps: AgentDeps
): Promise<AssistantReply> {
  const userId = ctx.session.sub;
  if (input.decision === "cancel") {
    await deps.cancelDraft(input.draftId, userId);
    await deps.audit({ userId, kind: "confirm", status: "cancelled", detail: { draft: input.draftId } });
    return { text: "Cancelled. Nothing was changed.", cards: [] };
  }

  const draft = await deps.claimDraft(input.draftId, userId);
  if (!draft) {
    const state = await deps.draftState(input.draftId, userId);
    return { text: STATE_MESSAGES[state] ?? STATE_MESSAGES["not found"], cards: [] };
  }
  const tool = (deps.tools ?? TOOLS).find((candidate) => candidate.name === draft.tool);
  const started = Date.now();
  const fail = async (error: string, status: AuditEntry["status"] = "error"): Promise<AssistantReply> => {
    await deps.finishDraft(draft.id, { ok: false, error });
    await deps.audit({ userId, kind: "confirm", tool: draft.tool, status, detail: { draft: draft.id, error }, latencyMs: Date.now() - started });
    const text = `Nothing was saved: ${error}`;
    return { text: "", memory: text, cards: [{ type: "notice", tone: "error", text }] };
  };
  if (!tool || tool.kind !== "write") return fail("This kind of change is no longer available.");
  // Permissions are checked again with the session confirming, not the one that asked.
  if (!mayUse(tool, ctx.session.isAdmin === true)) return fail(`Only an administrator can ${tool.label.toLowerCase()}.`, "denied");

  let result;
  try {
    result = await tool.execute(draft.args, ctx);
  } catch (error) {
    console.error(`[ai execute ${tool.name}]`, error);
    return fail("an unexpected error occurred. Check the page before trying again.");
  }
  if (!result.ok) return fail(result.error);

  await deps.finishDraft(draft.id, { ok: true, result: { recordId: result.recordId ?? null, text: result.text } });
  await deps.audit({
    userId,
    kind: "confirm",
    tool: tool.name,
    status: "ok",
    detail: { draft: draft.id, record: result.recordId ?? null, args: draft.args },
    latencyMs: Date.now() - started,
  });
  const card: Card = { type: "notice", tone: "success", text: result.text };
  return {
    text: "",
    memory: result.text,
    cards: [card],
    refresh: true,
    context: result.record ? { lastRecord: result.record } : undefined,
  };
}
