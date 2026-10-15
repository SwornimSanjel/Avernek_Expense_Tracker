import { guard, json } from "@/lib/ai/http";
import { OpenRouterError, transcribe, type AudioFormat } from "@/lib/ai/openrouter";
import { audit } from "@/lib/ai/store";
import { LIMITS } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Browser recording types → OpenRouter's input_audio.format. */
const FORMATS: Record<string, AudioFormat> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/**
 * Voice input: audio in, text out. The transcript goes back to the chat box
 * for the person to read and edit; nothing is submitted or saved from here.
 */
export async function POST(request: Request) {
  const guarded = await guard(request, { needsModel: true });
  if (guarded instanceof Response) return guarded;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.audioBytes + 64 * 1024) return json({ error: "That recording is too long. Keep it under a minute." }, 413);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("audio");
    file = entry instanceof File ? entry : null;
  } catch {
    // reported below
  }
  if (!file || file.size === 0) return json({ error: "No recording was received." }, 400);
  if (file.size > LIMITS.audioBytes) return json({ error: "That recording is too long. Keep it under a minute." }, 413);
  const type = file.type.split(";")[0].trim().toLowerCase();
  const format = FORMATS[type];
  if (!format) return json({ error: "This browser recorded an audio format that is not supported." }, 415);

  const { ctx, config } = guarded;
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const result = await transcribe(config!, { base64, format });
    await audit({
      userId: ctx.session.sub,
      kind: "transcription",
      status: result.text ? "ok" : "error",
      detail: { bytes: file.size, format, seconds: result.seconds, characters: result.text.length },
      model: result.model,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    });
    if (!result.text) return json({ error: "No speech was recognised. Try again a little closer to the microphone." }, 422);
    return json({ text: result.text });
  } catch (error) {
    await audit({ userId: ctx.session.sub, kind: "transcription", status: "error", detail: { bytes: file.size, format } });
    if (error instanceof OpenRouterError) {
      console.error("[ai transcribe]", error.message);
      return json({ error: "Transcription is not available right now. Type the message instead." }, 502);
    }
    console.error("[ai transcribe]", error);
    return json({ error: "Something went wrong with the recording. Try again." }, 500);
  }
}
