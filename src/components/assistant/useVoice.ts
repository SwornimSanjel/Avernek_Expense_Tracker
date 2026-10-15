"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS } from "@/lib/ai/types";

/** Formats the browser can record, in order of preference; the server accepts all of them. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export type VoicePhase =
  | { phase: "idle" }
  | { phase: "recording"; seconds: number }
  | { phase: "transcribing" };

/**
 * Push-to-talk recording. The recording is turned into text on the server and
 * handed to `onText`; the panel shows it for the person to send, edit or redo.
 * Nothing is ever sent or saved from here.
 */
export function useVoice({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<VoicePhase>({ phase: "idle" });
  const [supported, setSupported] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);

  useEffect(() => {
    setSupported(typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
    return () => {
      if (timer.current) clearInterval(timer.current);
      discard.current = true;
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const start = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("I can't use the microphone. Allow microphone access in your browser, then try again.");
      return;
    }
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    discard.current = false;
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
      const blob = new Blob(chunks, { type: (media.mimeType || mimeType || "audio/webm").split(";")[0] });
      if (discard.current || blob.size === 0) {
        setState({ phase: "idle" });
        return;
      }
      setState({ phase: "transcribing" });
      try {
        const body = new FormData();
        body.append("audio", blob, `voice.${blob.type.includes("mp4") ? "m4a" : blob.type.split("/")[1] ?? "webm"}`);
        const response = await fetch("/api/assistant/transcribe", { method: "POST", body, credentials: "same-origin" });
        const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!response.ok || !data.text) throw new Error(data.error ?? "I couldn't understand the recording. Try again, or type it.");
        onText(data.text);
      } catch (error) {
        onError(error instanceof Error ? error.message : "I couldn't understand the recording.");
      } finally {
        setState({ phase: "idle" });
      }
    };
    recorder.current = media;
    media.start();
    setState({ phase: "recording", seconds: 0 });
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setState({ phase: "recording", seconds });
      // A minute at most: the server refuses longer recordings anyway.
      if (seconds >= LIMITS.audioSeconds && media.state === "recording") media.stop();
    }, 250);
  }, [onError, onText]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { state, supported, start, stop, cancel };
}
