import { describe, expect, it } from "vitest";
import { strictSchema, toolDefinitions } from "./index";

describe("strict tool schemas", () => {
  it("lists every property as required but nullable, and allows nothing else", () => {
    const schema = strictSchema({
      type: "object",
      properties: {
        from: { type: "string", pattern: "^\\\\d{4}$", maxLength: 10 },
        funding: { type: "string", enum: ["personal", "company_funds"] },
        tags: { type: "array", items: { type: "string", maxLength: 80 } },
      },
    });
    expect(schema).toEqual({
      type: "object",
      properties: {
        from: { type: ["string", "null"], pattern: "^\\\\d{4}$" },
        funding: { type: ["string", "null"], enum: ["personal", "company_funds", null] },
        tags: { type: ["array", "null"], items: { type: "string" } },
      },
      required: ["from", "funding", "tags"],
      additionalProperties: false,
    });
  });

  it("produces a strict, closed schema for every tool", () => {
    for (const definition of toolDefinitions()) {
      const parameters = definition.function.parameters as { properties: Record<string, { type: unknown }>; required: string[]; additionalProperties: boolean };
      expect(definition.function.strict).toBe(true);
      expect(parameters.additionalProperties).toBe(false);
      expect(parameters.required.sort()).toEqual(Object.keys(parameters.properties).sort());
      for (const property of Object.values(parameters.properties)) expect(property.type).toContain("null");
      expect(JSON.stringify(parameters)).not.toMatch(/"(minLength|maxLength|\$schema)"/);
    }
  });
});
