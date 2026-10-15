import type { z } from "zod";
import type { Session } from "@/lib/auth/session";
import type { AssistantContext, Card, FormRequest, SavedRecord } from "../types";
import type { RequestData } from "../data";

export type ToolContext = {
  session: Session;
  /** The app's "today" (lib/income todayIso), so answers match the pages. */
  today: string;
  data: RequestData;
  /** What the conversation is about (client, last saved record), from the panel. Untrusted: ids are looked up, never assumed. */
  conversation?: AssistantContext;
};

/** A read tool's answer. `data` is the compact form the model may explain. */
export type ToolOk = {
  status: "ok";
  summary: string;
  cards: Card[];
  data?: unknown;
  context?: AssistantContext;
};

/** Details are missing (needs_input) or a name fits several records (needs_choice). */
export type ToolAsk = {
  status: "needs_input" | "needs_choice";
  summary: string;
  form: FormRequest;
};

/** A write tool has everything: this is what the person will confirm. */
export type ToolReady = {
  status: "ready";
  summary: string;
  draft: {
    title: string;
    rows: { label: string; value: string }[];
    warnings?: string[];
    confirmLabel: string;
    /** Exactly what execute() will receive after confirmation. */
    args: Record<string, unknown>;
  };
};

export type ToolFail = { status: "error" | "denied"; summary: string };

export type ToolOutcome = ToolOk | ToolAsk | ToolReady | ToolFail;

export type ExecuteResult =
  | { ok: true; text: string; recordId?: string; record?: SavedRecord }
  | { ok: false; error: string };

type BaseTool = {
  name: string;
  /** Shown under an answer, e.g. "Expense summary". */
  label: string;
  /** For the model: what the tool answers and when to use it. */
  description: string;
  /** Who may use it. Enforced on the server, never only in the prompt. */
  permission: "member" | "admin";
  /** The model-facing arguments: their JSON Schema is sent, and every call is validated. */
  schema: z.ZodType<Record<string, unknown>>;
};

export type ReadTool = BaseTool & {
  kind: "read";
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOk | ToolAsk | ToolFail>;
};

/**
 * A change to the books. run() never writes: it resolves names, works out what
 * is missing and returns a form, a choice, or a draft to confirm. execute()
 * runs only after confirmation, with the draft's stored arguments, re-validated
 * by the same server action the regular form uses.
 */
export type WriteTool = BaseTool & {
  kind: "write";
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolAsk | ToolReady | ToolFail>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ExecuteResult>;
};

export type Tool = ReadTool | WriteTool;
