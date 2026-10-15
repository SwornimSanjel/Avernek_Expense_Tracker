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
  { icon: "bank", text: "What's in our accounts right now?" },
];

const RESOLVED: Record<Resolution, { icon: IconName; text: string }> = {
  sent: { icon: "check", text: "Details sent" },
  confirmed: { icon: "check", text: "You confirmed" },
  cancelled: { icon: "close", text: "Cancelled" },
  editing: { icon: "edit", text: "Changing it below" },
};

/** The composer grows with what is typed, up to about six lines. */
function fitHeight(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  element.style.overflowY = element.scrollHeight > 168 ? "auto" : "hidden";
}

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
    const body = bodyRef.current;
    if (!body) return;
    // A new answer opens at its first line, so a long table is read from the
    // top; anything else (a question, "Thinking…") keeps the view at the end.
    const answer = !busy && messages.at(-1)?.role === "assistant" ? (body.lastElementChild as HTMLElement | null) : null;
    body.scrollTo({ top: answer ? answer.offsetTop - 16 : body.scrollHeight, behavior: "smooth" });
  }, [messages, busy, heard, voice.state.phase, open]);
  useEffect(() => fitHeight(inputRef.current), [draft, open]);
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
        <Icon name="sparkles" size={19} />
        <span>Ask AI</span>
      </button>
    );
  }

  const listening = voice.state.phase === "recording";
  const writing = voice.state.phase === "transcribing";
  const seconds = voice.state.phase === "recording" ? voice.state.seconds : 0;

  return (
    <div className="assistant-panel" role="dialog" aria-label="Finance assistant">
      <div className="assistant-head">
        <span className="assistant-avatar" aria-hidden="true">
          <Icon name="sparkles" size={19} />
        </span>
        <div className="assistant-head-title">
          <strong>Avernek AI</strong>
          <div className="assistant-head-sub">
            <span>Reads your books · asks before saving</span>
          </div>
        </div>
        {messages.length > 0 && (
          <button type="button" className="icon-btn" onClick={newChat} disabled={busy} aria-label="New chat" title="New chat">
            <Icon name="plus" />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </div>

      <div className="assistant-body" ref={bodyRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-welcome">
            <div>
              <span className="assistant-orb" aria-hidden="true">
                <Icon name="sparkles" size={26} />
              </span>
              <h2 className="assistant-hello">Hi {firstName}, how can I help?</h2>
              <p className="assistant-hello-sub">Ask about spending, income, clients or VAT — type it, or tap the mic and speak.</p>
            </div>
            <div>
              <div className="assistant-suggest-label">Try asking</div>
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion.text} type="button" className="assistant-suggestion" onClick={() => send(suggestion.text)}>
                    <span className="assistant-suggestion-icon">
                      <Icon name={suggestion.icon} size={18} />
                    </span>
                    <span className="assistant-suggestion-text">{suggestion.text}</span>
                    <Icon name="arrow" size={16} className="assistant-suggestion-arrow" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => {
          if (message.role === "user") return <div key={message.id} className="assistant-user">{message.text}</div>;
          if (message.role === "error") {
            return (
              <div key={message.id} className="alert alert-error assistant-error" role="alert">
                <Icon name="alert" size={18} />
                <span>{message.text}</span>
              </div>
            );
          }
          const { reply, resolved } = message;
          return (
            <div key={message.id} className="assistant-reply">
              {reply.text && <div className="assistant-text">{reply.text}</div>}
              <AssistantCards cards={reply.cards} />
              {reply.form &&
                (resolved ? (
                  <div className="assistant-resolved-line">
                    <Icon name={RESOLVED[resolved].icon} size={15} /> {RESOLVED[resolved].text}
                  </div>
                ) : (
                  <AssistantForm form={reply.form} disabled={busy} onSubmit={(values) => submitForm(message.id, reply.form!.tool, values)} />
                ))}
              {reply.confirm &&
                (resolved ? (
                  <div className="assistant-resolved-line">
                    <Icon name={RESOLVED[resolved].icon} size={15} /> {RESOLVED[resolved].text} · {reply.confirm.title.replace(/^Confirm /, "")}
                  </div>
                ) : (
                  <AssistantConfirm confirm={reply.confirm} disabled={busy} onDecide={(decision) => decide(message.id, reply.confirm!, decision)} />
                ))}
              {reply.steps?.length ? (
                <div className="assistant-steps">
                  <Icon name="layers" size={14} /> From {reply.steps.join(" · ")}
                </div>
              ) : null}
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
              rows={1}
              value={draft}
              maxLength={LIMITS.messageChars}
              placeholder="Ask anything…"
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
                <Icon name="mic" size={21} />
              </button>
            )}
            <button type="submit" className="assistant-send" disabled={busy || !draft.trim()} aria-label="Send" title="Send (Enter)">
              <Icon name="send" size={19} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
