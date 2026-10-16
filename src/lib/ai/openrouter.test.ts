import { describe, expect, it, vi } from "vitest";
import { readImage } from "./openrouter";
import type { AiConfig } from "./config";

const config: AiConfig = {
  apiKey: "test-key",
  primaryModel: "openai/gpt-4.1-mini",
  transcriptionModel: "x",
  transcriptionLanguage: null,
  appUrl: null,
  baseUrl: "https://openrouter.test/api/v1",
};

describe("readImage", () => {
  it("sends one photo with zero data retention and reads back JSON and cost", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("openai/gpt-4.1-mini");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.provider).toEqual({ zdr: true, data_collection: "deny" });
      const content = body.messages[0].content;
      expect(content[0].type).toBe("text");
      expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
      return new Response(
        JSON.stringify({
          model: "openai/gpt-4.1-mini",
          choices: [{ message: { content: '{"vendor":"Bhojan Griha","total":1130,"vat":130}' } }],
          usage: { prompt_tokens: 1820, completion_tokens: 60, cost: 0.000824 },
        }),
        { status: 200 }
      );
    });
    const result = await readImage(config, { instructions: "Read this bill", dataUrl: "data:image/jpeg;base64,AAAA" }, fetchImpl as typeof fetch);
    expect(JSON.parse(result.content!)).toEqual({ vendor: "Bhojan Griha", total: 1130, vat: 130 });
    expect(result.usage).toEqual({ promptTokens: 1820, completionTokens: 60, costUsd: 0.000824 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
