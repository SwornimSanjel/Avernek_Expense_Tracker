"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icons";
import { LIMITS, type AssistantContext, type AssistantReply, type ChatTurn, type ConfirmRequest } from "@/lib/ai/types";
import AssistantCards from "./AssistantCards";
import AssistantConfirm from "./AssistantConfirm";
import AssistantForm from "./AssistantForm";
import VoiceButton, { RecordingHint } from "./VoiceButton";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; reply: AssistantReply; resolved?: boolean }
  | { id: string; role: "error"; text: string };

type Stored = { messages: Message[]; context: AssistantContext };

/**
 * The conversation lives in this browser tab only (sessionStorage): nothing is
 * stored on the server, and closing the tab clears it. Only the last few turns
 * and the current client are sent with each message.
 */
const STORAGE_KEY = "avernek-assistant-v1";
const KEEP_MESSAGES = 40;

const SUGGESTIONS = [
  "How much did we spend this month?",
  "Which clients owe us money?",
  "Income this month with VAT and TDS",
  "Add an expense",
];

function load(): Stored {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      if (Array.isArray(parsed.messages)) return { messages: parsed.messages, context: parsed.context ?? {} };
    }
  } catch {
    // Storage blocked or corrupt: start empty.
  }
  return { messages: [], context: {} };
}

function save(state: Stored) {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: state.messages.slice(-KEEP_MESSAGES), context: state.context })
    );
  } catch {
    // Not fatal: the conversation just will not survive a reload.
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

async function post(path: string, body: unknown): Promise<AssistantReply> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // The middleware redirects to /login when the session has ended.
    throw new Error("Your session has ended. Reload the page and sign in again.");
  }
  const data = (await response.json()) as AssistantReply & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

export default function AssistantLauncher({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Stored>({ messages: [], context: {} });
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setState(load());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) save(state);
  }, [state, loaded]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [state.messages.length, busy, open]);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const push = useCallback((...messages: Message[]) => {
    setState((current) => ({ ...current, messages: [...current.messages, ...messages] }));
  }, []);

  const resolve = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) => (message.id === id && message.role === "assistant" ? { ...message, resolved: true } : message)),
    }));
  }, []);

  const receive = useCallback(
    (reply: AssistantReply) => {
      setState((current) => ({
        context: reply.context ?? current.context,
        messages: [...current.messages, { id: newId(), role: "assistant", reply }],
      }));
      if (reply.refresh) router.refresh();
    },
    [router]
  );

  const run = useCallback(
    async (work: () => Promise<AssistantReply>) => {
      setBusy(true);
      try {
        receive(await work());
      } catch (error) {
        push({ id: newId(), role: "error", text: error instanceof Error ? error.message : "Something went wrong." });
      } finally {
        setBusy(false);
      }
    },
    [push, receive]
  );

  function send(text: string) {
    const message = text.trim().slice(0, LIMITS.messageChars);
    if (!message || busy) return;
    const history: ChatTurn[] = state.messages
      .flatMap((item): ChatTurn[] =>
        item.role === "user"
          ? [{ role: "user", text: item.text }]
          : item.role === "assistant" && item.reply.text
            ? [{ role: "assistant", text: item.reply.text }]
            : []
      )
      .slice(-LIMITS.historyTurns);
    setDraft("");
    push({ id: newId(), role: "user", text: message });
    void run(() => post("/api/assistant/chat", { message, history, context: state.context }));
  }

  function submitForm(messageId: string, tool: string, values: Record<string, unknown>) {
    resolve(messageId);
    void run(() => post("/api/assistant/form", { tool, values }));
  }

  function decide(messageId: string, confirm: ConfirmRequest, decision: "confirm" | "cancel" | "edit") {
    resolve(messageId);
    if (decision === "edit") {
      // Discard this draft, then reopen its values as a form.
      void run(async () => {
        await post("/api/assistant/confirm", { draftId: confirm.draftId, decision: "cancel" }).catch(() => null);
        return post("/api/assistant/form", { tool: confirm.tool, values: { ...confirm.values, _edit: true } });
      });
      return;
    }
    void run(() => post("/api/assistant/confirm", { draftId: confirm.draftId, decision }));
  }

  function clear() {
    setState({ messages: [], context: {} });
    setDraft("");
  }

  if (!open) {
    return (
      <button type="button" className="assistant-launcher" onClick={() => setOpen(true)} aria-label="Open the finance assistant">
        <Icon name="sparkles" />
        <span>Ask</span>
      </button>
    );
  }

  return (
    <div className="assistant-panel" role="dialog" aria-label="Finance assistant">
      <div className="assistant-head">
        <Icon name="sparkles" />
        <div className="assistant-head-title">
          Finance assistant
          <div className="assistant-head-sub">Answers come from your books. Changes always ask you to confirm.</div>
        </div>
        {state.messages.length > 0 && (
          <button type="button" className="btn !h-8 !px-3 text-[11px]" onClick={clear} disabled={busy}>
            New chat
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close the assistant">
          <Icon name="close" />
        </button>
      </div>

      <div className="assistant-body" ref={bodyRef} aria-live="polite">
        {state.messages.length === 0 && (
          <div className="assistant-reply">
            <div className="assistant-text">
              Hi {firstName}. Ask about expenses, subscriptions, clients and their payments, income, VAT and TDS, or account
              balances. You can also add an expense or record a client payment; I&apos;ll ask for anything missing and you
              confirm before anything is saved.
            </div>
            <div className="assistant-chips">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="assistant-chip" onClick={() => send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {state.messages.map((message) => {
          if (message.role === "user") return <div key={message.id} className="assistant-user">{message.text}</div>;
          if (message.role === "error") return <div key={message.id} className="alert alert-error" role="alert">{message.text}</div>;
          const { reply } = message;
          return (
            <div key={message.id} className="assistant-reply">
              {reply.text && <div className="assistant-text">{reply.text}</div>}
              <AssistantCards cards={reply.cards} />
              {reply.form && (
                <AssistantForm
                  form={reply.form}
                  disabled={Boolean(message.resolved) || busy}
                  onSubmit={(values) => submitForm(message.id, reply.form!.tool, values)}
                />
              )}
              {reply.confirm && (
                <AssistantConfirm
                  confirm={reply.confirm}
                  disabled={Boolean(message.resolved) || busy}
                  onDecide={(decision) => decide(message.id, reply.confirm!, decision)}
                />
              )}
              {reply.steps?.length ? <div className="assistant-steps">From: {reply.steps.join(" · ")}</div> : null}
            </div>
          );
        })}

        {busy && (
          <div className="assistant-thinking">
            <span className="assistant-dot" style={{ background: "var(--accent)" }} />
            Working…
          </div>
        )}
      </div>

      <div className="assistant-foot">
        {recording != null && <RecordingHint seconds={recording} />}
        <form
          className="assistant-composer mt-1"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <textarea
            ref={inputRef}
            className="input"
            rows={1}
            value={draft}
            maxLength={LIMITS.messageChars}
            placeholder="Ask, or say what to add…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            aria-label="Message"
            disabled={busy}
          />
          <VoiceButton
            disabled={busy}
            onRecording={setRecording}
            onTranscript={(text) => {
              setDraft((current) => (current ? `${current} ${text}` : text));
              inputRef.current?.focus();
            }}
            onError={(text) => push({ id: newId(), role: "error", text })}
          />
          <button type="submit" className="icon-btn" style={{ width: 46, height: 46 }} disabled={busy || !draft.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        </form>
      </div>
    </div>
  );
}
