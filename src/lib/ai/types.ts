/**
 * Shapes shared by the AI assistant's server code and its chat panel.
 *
 * Imported by client components, so this file must never import server code.
 * Every figure in a card is formatted on the server: the panel only lays out
 * strings, so it can never compute or round a financial value differently.
 */

export type Tone = "default" | "good" | "warn" | "bad";

export type Card =
  | {
      type: "stats";
      title?: string;
      items: { label: string; value: string; hint?: string; tone?: Tone }[];
    }
  | {
      type: "table";
      title: string;
      columns: { key: string; label: string; align?: "left" | "right" }[];
      rows: Record<string, string>[];
      /** A totals row, keyed like the columns. */
      footer?: Record<string, string>;
      note?: string;
    }
  | {
      type: "facts";
      title: string;
      items: { label: string; value: string; hint?: string }[];
      note?: string;
    }
  | { type: "notice"; tone: "info" | "warn" | "error"; text: string };

export type FieldOption = { value: string; label: string; hint?: string };

export type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "month" | "select" | "multiselect" | "choice";
  required: boolean;
  options?: FieldOption[];
  value?: string | string[] | null;
  placeholder?: string;
  help?: string;
  error?: string;
  min?: number;
  step?: number;
};

/**
 * Missing or ambiguous details, asked for in one form. `values` carries what is
 * already known, so submitting the form never loses it.
 */
export type FormRequest = {
  tool: string;
  title: string;
  message?: string;
  values: Record<string, unknown>;
  fields: FieldSpec[];
  submitLabel: string;
};

/** A prepared financial change, waiting for the person to confirm it. */
export type ConfirmRequest = {
  draftId: string;
  tool: string;
  title: string;
  rows: { label: string; value: string }[];
  warnings?: string[];
  confirmLabel: string;
  /** The values behind the draft, so "Edit" can reopen the form with them. */
  values: Record<string, unknown>;
};

/** What the conversation is about, kept in the browser and sent back. */
export type AssistantContext = {
  /** The client the last answer was about, for "how much is remaining?". */
  client?: string;
};

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type AssistantReply = {
  text: string;
  cards: Card[];
  form?: FormRequest;
  confirm?: ConfirmRequest;
  /** Labels of the tools that produced this answer, shown under it. */
  steps?: string[];
  context?: AssistantContext;
  /** True after a change was saved: the page behind the panel reloads its data. */
  refresh?: boolean;
};

export const LIMITS = {
  messageChars: 1500,
  historyTurns: 8,
  historyChars: 1500,
  audioBytes: 5 * 1024 * 1024,
  audioSeconds: 60,
} as const;
