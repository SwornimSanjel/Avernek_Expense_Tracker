"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icons";
import { LIMITS } from "@/lib/ai/types";

/** Formats the browser can record, in order of preference; all are accepted by the server. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/**
 * Push-to-record voice input. The recording is transcribed on the server and
 * the text is put in the message box for the person to check and edit: it is
 * never sent, and never changes anything, by itself.
 */
export default function VoiceButton({
  disabled,
  onTranscript,
  onError,
  onRecording,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  /** Seconds recorded so far while recording; null otherwise. */
  onRecording: (seconds: number | null) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported =
    typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    []
  );

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Microphone access was blocked. Allow it in the browser to use voice input.");
      return;
    }
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
      onRecording(null);
      const blob = new Blob(chunks, { type: (media.mimeType || mimeType || "audio/webm").split(";")[0] });
      if (blob.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const body = new FormData();
        body.append("audio", blob, `voice.${blob.type.includes("mp4") ? "m4a" : blob.type.split("/")[1] ?? "webm"}`);
        const response = await fetch("/api/assistant/transcribe", { method: "POST", body, credentials: "same-origin" });
        const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!response.ok || !data.text) throw new Error(data.error ?? "Transcription failed. Type the message instead.");
        onTranscript(data.text);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Transcription failed.");
      } finally {
        setState("idle");
      }
    };
    recorder.current = media;
    media.start();
    setState("recording");
    onRecording(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      onRecording(elapsed);
      // A minute at most: the server refuses longer recordings anyway.
      if (elapsed >= LIMITS.audioSeconds && media.state === "recording") media.stop();
    }, 250);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  if (!supported) return null;
  if (state === "recording") {
    return (
      <button type="button" className="icon-btn" style={{ width: 46, height: 46, color: "var(--red)" }} onClick={stop} aria-label="Stop recording">
        <Icon name="stop" />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="icon-btn"
      style={{ width: 46, height: 46 }}
      onClick={start}
      disabled={disabled || state === "transcribing"}
      aria-label={state === "transcribing" ? "Transcribing…" : "Record a voice message"}
      title="Voice input (up to a minute)"
    >
      <Icon name="mic" />
    </button>
  );
}

/** Shown above the composer while recording. */
export function RecordingHint({ seconds }: { seconds: number }) {
  return (
    <div className="assistant-recording">
      <span className="assistant-dot" />
      Recording… {seconds}s / {LIMITS.audioSeconds}s
    </div>
  );
}
