"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icons";
import { LIMITS, type AssistantContext, type AssistantReply, type ChatTurn, type ConfirmRequest } from "@/lib/ai/types";
import AssistantCards from "./AssistantCards";
import AssistantConfirm from "./AssistantConfirm";
import AssistantForm from "./AssistantForm";
import { useVoice } from "./useVoice";

/** How a form or confirmation was answered, shown as one line once it is done. */
type Resolution = "sent" | "confirmed" | "cancelled" | "editing";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; reply: AssistantReply; resolved?: Resolution }
  | { id: string; role: "error"; text: string };

const SUGGESTIONS: { icon: IconName; text: string }[] = [
  { icon: "wallet", text: "How much did we spend this month?" },
  { icon: "users", text: "Who still owes us money?" },
  { icon: "plus", text: "Add an expense" },
  { icon: "income", text: "Income this month with VAT and TDS" },
  { icon: "calendar", text: "What is today's date?" },
];

const RESOLVED_LABEL: Record<Resolution, string> = {
  sent: "✓ Details sent",
  confirmed: "✓ You confirmed",
  cancelled: "✕ Cancelled",
  editing: "✎ Changing it below",
};

const newId = () => Math.random().toString(36).slice(2, 10);

async function post(path: string, body: unknown): Promise<AssistantReply> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    // The middleware redirects to /login when the session has ended.
    throw new Error("You've been signed out. Reload the page and sign in again.");
  }
  const data = (await response.json()) as AssistantReply & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

/**
 * The finance assistant. The conversation lives only in this component's
 * memory: moving between pages keeps it, a page reload starts a fresh chat,
 * and nothing is stored on the server. The last turns and the conversation's
 * context (current client, last saved record) go with each message.
 */
export default function AssistantLauncher({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<AssistantContext>({});
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const push = useCallback((...items: Message[]) => setMessages((current) => [...current, ...items]), []);
  const voice = useVoice({
    onText: (text) => setHeard(text),
    onError: (text) => push({ id: newId(), role: "error", text }),
  });

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, heard, voice.state.phase, open]);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const receive = useCallback(
    (reply: AssistantReply) => {
      push({ id: newId(), role: "assistant", reply });
      if (reply.context) setContext((current) => ({ ...current, ...reply.context }));
      if (reply.refresh) router.refresh();
    },
    [push, router]
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

  const resolve = (id: string, how: Resolution) =>
    setMessages((current) =>
      current.map((message) => (message.id === id && message.role === "assistant" ? { ...message, resolved: how } : message))
    );

  function send(text: string) {
    const message = text.trim().slice(0, LIMITS.messageChars);
    if (!message || busy) return;
    // What the model remembers of each earlier answer: its compact memory line.
    const history: ChatTurn[] = messages
      .flatMap((item): ChatTurn[] => {
        if (item.role === "user") return [{ role: "user", text: item.text }];
        if (item.role === "assistant") {
          const said = item.reply.memory || item.reply.text;
          return said ? [{ role: "assistant", text: said }] : [];
        }
        return [];
      })
      .slice(-LIMITS.historyTurns);
    setDraft("");
    setHeard(null);
    push({ id: newId(), role: "user", text: message });
    void run(() => post("/api/assistant/chat", { message, history, context }));
  }

  function submitForm(messageId: string, tool: string, values: Record<string, unknown>) {
    resolve(messageId, "sent");
    void run(() => post("/api/assistant/form", { tool, values, context }));
  }

  function decide(messageId: string, confirm: ConfirmRequest, decision: "confirm" | "cancel" | "edit") {
    resolve(messageId, decision === "confirm" ? "confirmed" : decision === "cancel" ? "cancelled" : "editing");
    if (decision === "edit") {
      // Discard this draft, then reopen its values as a form.
      void run(async () => {
        await post("/api/assistant/confirm", { draftId: confirm.draftId, decision: "cancel" }).catch(() => null);
        return post("/api/assistant/form", { tool: confirm.tool, values: { ...confirm.values, _edit: true }, context });
      });
      return;
    }
    void run(() => post("/api/assistant/confirm", { draftId: confirm.draftId, decision }));
  }

  function newChat() {
    setMessages([]);
    setContext({});
    setDraft("");
    setHeard(null);
  }

  if (!open) {
    return (
      <button type="button" className="assistant-launcher" onClick={() => setOpen(true)} aria-label="Open the finance assistant">
        <Icon name="sparkles" />
        <span>Ask</span>
      </button>
    );
  }

  const listening = voice.state.phase === "recording";
  const writing = voice.state.phase === "transcribing";
  const seconds = voice.state.phase === "recording" ? voice.state.seconds : 0;

  return (
    <div className="assistant-panel" role="dialog" aria-label="Finance assistant">
      <div className="assistant-head">
        <Icon name="sparkles" />
        <div className="assistant-head-title">
          Ask me anything
          <div className="assistant-head-sub">I look things up in your books, and I always ask before saving.</div>
        </div>
        {messages.length > 0 && (
          <button type="button" className="btn !h-9 !px-3 text-[12px]" onClick={newChat} disabled={busy}>
            <Icon name="plus" size={14} /> New chat
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>

      <div className="assistant-body" ref={bodyRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-reply">
            <div className="assistant-hello">Hi {firstName}! What would you like to know?</div>
            <div className="assistant-text">Tap a question, type one, or tap the microphone and speak.</div>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion.text} type="button" className="assistant-suggestion" onClick={() => send(suggestion.text)}>
                  <Icon name={suggestion.icon} size={18} />
                  <span>{suggestion.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          if (message.role === "user") return <div key={message.id} className="assistant-user">{message.text}</div>;
          if (message.role === "error") return <div key={message.id} className="alert alert-error" role="alert">{message.text}</div>;
          const { reply, resolved } = message;
          return (
            <div key={message.id} className="assistant-reply">
              {reply.text && <div className="assistant-text">{reply.text}</div>}
              <AssistantCards cards={reply.cards} />
              {reply.form &&
                (resolved ? (
                  <div className="assistant-resolved-line">{RESOLVED_LABEL[resolved]}</div>
                ) : (
                  <AssistantForm form={reply.form} disabled={busy} onSubmit={(values) => submitForm(message.id, reply.form!.tool, values)} />
                ))}
              {reply.confirm &&
                (resolved ? (
                  <div className="assistant-resolved-line">
                    {RESOLVED_LABEL[resolved]} · {reply.confirm.title.replace(/^Confirm /, "")}
                  </div>
                ) : (
                  <AssistantConfirm confirm={reply.confirm} disabled={busy} onDecide={(decision) => decide(message.id, reply.confirm!, decision)} />
                ))}
              {reply.steps?.length ? <div className="assistant-steps">From: {reply.steps.join(" · ")}</div> : null}
            </div>
          );
        })}

        {busy && (
          <div className="assistant-thinking" role="status">
            <span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span>
            Thinking…
          </div>
        )}
      </div>

      <div className="assistant-foot">
        {listening ? (
          <div className="assistant-voice-bar" role="status">
            <span className="assistant-dot" />
            <div className="assistant-voice-text">
              Listening… speak now
              <small>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} of 1:00
              </small>
            </div>
            <button type="button" className="btn" onClick={voice.cancel}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={voice.stop}>
              <Icon name="check" size={16} /> Done
            </button>
          </div>
        ) : writing ? (
          <div className="assistant-voice-bar" role="status">
            <span className="assistant-spinner" aria-hidden="true" />
            <div className="assistant-voice-text">
              Writing down what you said…
              <small>This takes a few seconds.</small>
            </div>
          </div>
        ) : heard != null ? (
          <div className="assistant-heard">
            <div className="assistant-heard-label">You said:</div>
            <div className="assistant-heard-text">“{heard}”</div>
            <div className="assistant-actions">
              <button type="button" className="btn btn-primary" onClick={() => send(heard)} disabled={busy}>
                <Icon name="send" size={16} /> Send
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraft(heard);
                  setHeard(null);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <Icon name="edit" size={16} /> Edit
              </button>
              <button type="button" className="btn" onClick={() => { setHeard(null); void voice.start(); }}>
                <Icon name="mic" size={16} /> Say again
              </button>
            </div>
          </div>
        ) : (
          <form
            className="assistant-composer"
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
              placeholder={voice.supported ? "Type here, or tap the mic and speak" : "Type your question here"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
              aria-label="Your message"
              disabled={busy}
            />
            {voice.supported && (
              <button type="button" className="assistant-mic" onClick={() => void voice.start()} disabled={busy} aria-label="Speak" title="Tap and speak">
                <Icon name="mic" size={20} />
              </button>
            )}
            <button type="submit" className="assistant-send" disabled={busy || !draft.trim()} aria-label="Send">
              <Icon name="send" size={20} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
