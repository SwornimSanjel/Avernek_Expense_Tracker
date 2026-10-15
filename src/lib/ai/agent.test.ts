import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runChat, runConfirm, runForm, type AgentDeps } from "./agent";
import type { ChatRequest, ChatResult, ToolCall } from "./openrouter";
import type { Draft } from "./store";
import type { ReadTool, ToolContext, WriteTool } from "./tools/types";

function ctx(isAdmin = true): ToolContext {
  return {
    session: { sub: "user-1", email: "a@avernek.com", name: "Pragyan", isAdmin, exp: 0 },
    today: "2026-10-15",
    data: {} as ToolContext["data"],
  };
}

const call = (name: string, args: unknown, id = `call-${name}`): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

const answer = (toolCalls: ToolCall[], content: string | null = null): ChatResult => ({
  content,
  toolCalls,
  usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.0001 },
  model: "openai/gpt-4.1-mini",
  latencyMs: 5,
});

const totalTool: ReadTool = {
  name: "get_total",
  label: "Total",
  kind: "read",
  permission: "member",
  description: "",
  schema: z.object({ explain: z.boolean().optional() }),
  run: vi.fn(async () => ({
    status: "ok" as const,
    summary: "Avernek spent NPR 12,500.",
    cards: [{ type: "stats" as const, items: [{ label: "Total", value: "NPR 12,500" }] }],
    data: { total_npr: 12500 },
    context: { client: "Kalika Technical" },
  })),
};

const addTool: WriteTool = {
  name: "add_thing",
  label: "Add thing",
  kind: "write",
  permission: "admin",
  description: "",
  schema: z.object({ amount: z.number().optional() }),
  run: vi.fn(async (args: Record<string, unknown>) =>
    args.amount
      ? {
          status: "ready" as const,
          summary: "Ready. Please confirm.",
          draft: { title: "Confirm", rows: [{ label: "Amount", value: "NPR 5" }], confirmLabel: "Save", args: { amount: args.amount } },
        }
      : {
          status: "needs_input" as const,
          summary: "Need the amount.",
          form: { tool: "add_thing", title: "Details", values: {}, fields: [], submitLabel: "Review" },
        }
  ),
  execute: vi.fn(async () => ({ ok: true as const, text: "Saved NPR 5.", recordId: "rec-1" })),
};

function deps(responses: ChatResult[], drafts = new Map<string, Draft>()) {
  const chat = vi.fn(async (_request: ChatRequest) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected model call");
    return next;
  });
  const audit = vi.fn(async () => {});
  const value: AgentDeps = {
    chat,
    audit,
    tools: [totalTool, addTool],
    createDraft: vi.fn(async (userId, tool, args, summary) => {
      const id = `draft-${drafts.size + 1}`;
      drafts.set(id, { id, user_id: userId, tool, args, summary, status: "pending", expires_at: "" });
      return id;
    }),
    // The real claim is one UPDATE … WHERE status = 'pending'; this mirrors it.
    claimDraft: vi.fn(async (id, userId) => {
      const draft = drafts.get(id);
      if (!draft || draft.user_id !== userId || draft.status !== "pending") return null;
      draft.status = "executing";
      return { ...draft };
    }),
    finishDraft: vi.fn(async (id, outcome) => {
      drafts.get(id)!.status = outcome.ok ? "done" : "failed";
    }),
    cancelDraft: vi.fn(async (id) => {
      const draft = drafts.get(id);
      if (draft?.status !== "pending") return false;
      draft.status = "cancelled";
      return true;
    }),
    // Like the real query, another person's draft does not exist for you.
    draftState: vi.fn(async (id, userId) => {
      const draft = drafts.get(id);
      return draft && draft.user_id === userId ? draft.status : "not found";
    }),
  };
  return { deps: value, chat, audit, drafts };
}

const input = (message: string) => ({ message, history: [], context: {} });

describe("runChat", () => {
  it("answers in text when no tool is needed", async () => {
    const { deps: d, chat } = deps([answer([], "Hello! Ask me about expenses.")]);
    const reply = await runChat(input("hi"), ctx(), d);
    expect(reply.text).toBe("Hello! Ask me about expenses.");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("answers plain questions from the tool's own summary, with one model call", async () => {
    const { deps: d, chat, audit } = deps([answer([call("get_total", {})])]);
    const reply = await runChat(input("total expenses?"), ctx(), d);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(reply.text).toBe("Avernek spent NPR 12,500.");
    expect(reply.cards).toHaveLength(1);
    expect(reply.steps).toEqual(["Total"]);
    expect(reply.context).toEqual({ client: "Kalika Technical" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: "tool", tool: "get_total", status: "ok" }));
  });

  it("sends only the tools' data back when an explanation is asked for", async () => {
    const { deps: d, chat } = deps([answer([call("get_total", { explain: true })]), answer([], "Spending rose because of hosting.")]);
    const reply = await runChat(input("why did spending rise?"), ctx(), d);
    expect(chat).toHaveBeenCalledTimes(2);
    const second = chat.mock.calls[1][0];
    expect(second.toolChoice).toBe("none");
    const toolMessage = second.messages.find((m) => m.role === "tool");
    expect(toolMessage && JSON.parse(toolMessage.content)).toEqual({
      status: "ok",
      summary: "Avernek spent NPR 12,500.",
      data: { total_npr: 12500 },
    });
    expect(reply.text).toBe("Spending rose because of hosting.");
    expect(reply.cards).toHaveLength(1);
  });

  it("keeps the figures when the explanation call fails", async () => {
    const { deps: d } = deps([answer([call("get_total", { explain: true })])]);
    const reply = await runChat(input("why?"), ctx(), d);
    expect(reply.text).toBe("Avernek spent NPR 12,500.");
  });

  it("reports unknown tools and unreadable arguments instead of running anything", async () => {
    const { deps: d } = deps([answer([call("drop_table", {}), call("get_total", "{not json")])]);
    const reply = await runChat(input("x"), ctx(), d);
    expect(reply.cards.filter((card) => card.type === "notice")).toHaveLength(2);
  });

  it("enforces permissions on the server, whatever the model chose", async () => {
    vi.mocked(addTool.run).mockClear();
    const { deps: d } = deps([answer([call("add_thing", { amount: 5 })])]);
    const reply = await runChat(input("add 5"), ctx(false), d);
    expect(addTool.run).not.toHaveBeenCalled();
    expect(reply.confirm).toBeUndefined();
    expect(reply.text).toMatch(/Only an administrator/);
  });

  it("turns a change into a draft to confirm, never a write", async () => {
    vi.mocked(addTool.execute).mockClear();
    const { deps: d, drafts } = deps([answer([call("add_thing", { amount: 5 })])]);
    const reply = await runChat(input("add 5"), ctx(), d);
    expect(reply.confirm).toMatchObject({ draftId: "draft-1", title: "Confirm", confirmLabel: "Save" });
    expect(drafts.get("draft-1")?.status).toBe("pending");
    expect(addTool.execute).not.toHaveBeenCalled();
  });

  it("prepares one change per message", async () => {
    const { deps: d, drafts } = deps([answer([call("add_thing", { amount: 5 }, "a"), call("add_thing", { amount: 7 }, "b")])]);
    await runChat(input("add 5 and 7"), ctx(), d);
    expect(drafts.size).toBe(1);
  });

  it("asks with a form when details are missing", async () => {
    const { deps: d } = deps([answer([call("add_thing", {})])]);
    const reply = await runChat(input("add a thing"), ctx(), d);
    expect(reply.form?.tool).toBe("add_thing");
    expect(reply.confirm).toBeUndefined();
  });
});

describe("runForm", () => {
  it("re-runs the tool with the submitted values, without a model call", async () => {
    const { deps: d, chat } = deps([]);
    const reply = await runForm({ tool: "add_thing", values: { amount: 5 } }, ctx(), d);
    expect(chat).not.toHaveBeenCalled();
    expect(reply.confirm?.draftId).toBe("draft-1");
  });
});

describe("runConfirm", () => {
  async function prepared(isAdmin = true) {
    const setup = deps([answer([call("add_thing", { amount: 5 })])]);
    const reply = await runChat(input("add 5"), ctx(isAdmin), setup.deps);
    return { ...setup, draftId: reply.confirm!.draftId };
  }

  it("executes a confirmed draft once, and reports the second click", async () => {
    vi.mocked(addTool.execute).mockClear();
    const { deps: d, draftId, drafts } = await prepared();
    const first = await runConfirm({ draftId, decision: "confirm" }, ctx(), d);
    const second = await runConfirm({ draftId, decision: "confirm" }, ctx(), d);
    expect(addTool.execute).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ text: "Saved NPR 5.", refresh: true });
    expect(second.text).toBe("This was already saved.");
    expect(drafts.get(draftId)?.status).toBe("done");
  });

  it("does nothing when cancelled", async () => {
    vi.mocked(addTool.execute).mockClear();
    const { deps: d, draftId } = await prepared();
    expect((await runConfirm({ draftId, decision: "cancel" }, ctx(), d)).text).toBe("Cancelled. Nothing was changed.");
    expect((await runConfirm({ draftId, decision: "confirm" }, ctx(), d)).text).toMatch(/cancelled/);
    expect(addTool.execute).not.toHaveBeenCalled();
  });

  it("re-checks permission with the session that confirms", async () => {
    vi.mocked(addTool.execute).mockClear();
    const { deps: d, draftId, drafts } = await prepared();
    const reply = await runConfirm({ draftId, decision: "confirm" }, ctx(false), d);
    expect(addTool.execute).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/Nothing was saved/);
    expect(drafts.get(draftId)?.status).toBe("failed");
  });

  it("never reports success when saving fails", async () => {
    vi.mocked(addTool.execute).mockResolvedValueOnce({ ok: false, error: "Only NPR 10 is still owed." });
    const { deps: d, draftId } = await prepared();
    const reply = await runConfirm({ draftId, decision: "confirm" }, ctx(), d);
    expect(reply.text).toBe("Nothing was saved: Only NPR 10 is still owed.");
    expect(reply.refresh).toBeUndefined();
  });

  it("refuses another person's draft", async () => {
    vi.mocked(addTool.execute).mockClear();
    const { deps: d, draftId } = await prepared();
    const someoneElse = { ...ctx(), session: { ...ctx().session, sub: "user-2" } };
    const reply = await runConfirm({ draftId, decision: "confirm" }, someoneElse, d);
    expect(addTool.execute).not.toHaveBeenCalled();
    expect(reply.text).toBe("That confirmation could not be found. Ask again.");
  });
});
