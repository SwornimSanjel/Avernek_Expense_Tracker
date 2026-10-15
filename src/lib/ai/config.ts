/**
 * AI assistant settings, read from the server environment (.env, which the
 * pipeline installs from the Jenkins credential). Server-only: nothing here may
 * be imported by a client component, and the API key is never logged, returned
 * or sent anywhere but OpenRouter.
 *
 * With no OPENROUTER_API_KEY the assistant is switched off: the launcher is not
 * rendered and its endpoints answer 503. The rest of the app is unaffected.
 */

export type AiConfig = {
  apiKey: string;
  /** Understands requests and picks tools. */
  primaryModel: string;
  /** Speech to text, through OpenRouter's /audio/transcriptions. */
  transcriptionModel: string;
  /** ISO-639-1 hint ("en", "ne"); unset lets the model detect it. */
  transcriptionLanguage: string | null;
  /** Sent as HTTP-Referer, which OpenRouter shows in its activity log. */
  appUrl: string | null;
  /** OpenRouter's API; only changed for local end-to-end tests against a fake. */
  baseUrl: string;
};

export const DEFAULT_PRIMARY_MODEL = "openai/gpt-4.1-mini";
export const DEFAULT_TRANSCRIPTION_MODEL = "qwen/qwen3-asr-1.7b";

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    primaryModel: env.AI_PRIMARY_MODEL?.trim() || DEFAULT_PRIMARY_MODEL,
    transcriptionModel: env.AI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL,
    transcriptionLanguage: env.AI_TRANSCRIPTION_LANGUAGE?.trim() || null,
    appUrl: env.PUBLIC_URL?.trim() || null,
    baseUrl: (env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  };
}

export function isAiEnabled(): boolean {
  return aiConfig() !== null;
}
