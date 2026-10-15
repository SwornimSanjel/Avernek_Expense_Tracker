import type { AiConfig } from "./config";

/**
 * The only code that talks to OpenRouter. Plain fetch, no SDK.
 *
 * Every request asks for Zero Data Retention routing (`provider.zdr`) and
 * denies providers that collect data: a request that cannot be served under
 * that policy fails rather than falling back to a provider that keeps it.
 * Enable ZDR in the OpenRouter account's privacy settings as well.
 */

const DATA_POLICY = { zdr: true, data_collection: "deny" } as const;

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  /** USD, as OpenRouter charged it; null when it was not reported. */
  costUsd: number | null;
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none";
  maxTokens?: number;
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  latencyMs: number;
};

export type TranscriptionResult = {
  text: string;
  seconds: number | null;
  costUsd: number | null;
  model: string;
  latencyMs: number;
};

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

type Fetch = typeof fetch;

async function post(
  config: AiConfig,
  path: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl: Fetch
): Promise<{ json: Record<string, unknown>; latencyMs: number }> {
  const started = Date.now();
  // One retry, only for rate limits, server errors and timeouts: a 4xx means
  // the request itself is wrong and will fail the same way again.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Avernek Expense Tracker",
          ...(config.appUrl ? { "HTTP-Referer": config.appUrl } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        // A proxy error page, for instance: reported by status below.
      }
      const bodyError = errorMessage(json);
      if (response.ok && !bodyError) return { json, latencyMs: Date.now() - started };

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= 1) {
        throw new OpenRouterError(
          `OpenRouter answered ${response.status}${bodyError ? `: ${bodyError}` : ""}`,
          response.status
        );
      }
    } catch (error) {
      if (error instanceof OpenRouterError) throw error;
      const timedOut = (error as { name?: string })?.name === "AbortError";
      if (attempt >= 1) {
        throw new OpenRouterError(
          timedOut ? `OpenRouter did not answer within ${timeoutMs / 1000}s` : "OpenRouter could not be reached"
        );
      }
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

/** OpenRouter's own error text, shortened; it never contains the key. */
function errorMessage(json: Record<string, unknown>): string | null {
  const error = json.error as { message?: unknown } | string | undefined;
  if (!error) return null;
  const message = typeof error === "string" ? error : String(error.message ?? "unknown error");
  return message.slice(0, 200);
}

function usageOf(json: Record<string, unknown>): Usage {
  const usage = (json.usage ?? {}) as Record<string, unknown>;
  const cost = Number(usage.cost);
  return {
    promptTokens: Number(usage.prompt_tokens ?? 0) || 0,
    completionTokens: Number(usage.completion_tokens ?? 0) || 0,
    costUsd: Number.isFinite(cost) ? cost : null,
  };
}

export async function chat(
  config: AiConfig,
  request: ChatRequest,
  fetchImpl: Fetch = fetch
): Promise<ChatResult> {
  const { json, latencyMs } = await post(
    config,
    "/chat/completions",
    {
      model: config.primaryModel,
      messages: request.messages,
      ...(request.tools?.length
        ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto", parallel_tool_calls: true }
        : {}),
      temperature: 0,
      max_tokens: request.maxTokens ?? 700,
      provider: DATA_POLICY,
    },
    30_000,
    fetchImpl
  );
  const choice = (json.choices as { message?: Record<string, unknown> }[] | undefined)?.[0];
  if (!choice?.message) throw new OpenRouterError("OpenRouter returned no answer");
  const message = choice.message;
  const toolCalls = Array.isArray(message.tool_calls)
    ? (message.tool_calls as ToolCall[]).filter(
        (call) => call?.type === "function" && typeof call.function?.name === "string"
      )
    : [];
  return {
    content: typeof message.content === "string" ? message.content : null,
    toolCalls,
    usage: usageOf(json),
    model: typeof json.model === "string" ? json.model : config.primaryModel,
    latencyMs,
  };
}

/** Audio formats OpenRouter's transcription endpoint accepts. */
export const AUDIO_FORMATS = ["webm", "ogg", "m4a", "mp3", "wav", "flac", "aac"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export async function transcribe(
  config: AiConfig,
  audio: { base64: string; format: AudioFormat },
  fetchImpl: Fetch = fetch
): Promise<TranscriptionResult> {
  const { json, latencyMs } = await post(
    config,
    "/audio/transcriptions",
    {
      model: config.transcriptionModel,
      input_audio: { data: audio.base64, format: audio.format },
      ...(config.transcriptionLanguage ? { language: config.transcriptionLanguage } : {}),
      temperature: 0,
      provider: DATA_POLICY,
    },
    45_000,
    fetchImpl
  );
  const usage = (json.usage ?? {}) as Record<string, unknown>;
  const seconds = Number(usage.seconds);
  const cost = Number(usage.cost);
  return {
    text: typeof json.text === "string" ? json.text.trim() : "",
    seconds: Number.isFinite(seconds) ? seconds : null,
    costUsd: Number.isFinite(cost) ? cost : null,
    model: config.transcriptionModel,
    latencyMs,
  };
}
