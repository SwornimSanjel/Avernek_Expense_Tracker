import { z } from "zod";
import type { ToolDefinition } from "../openrouter";
import { listCompanyBills } from "./bills";
import { getClientOverview, getClientPayments, getReceivables, getUpcomingPayments, listClients } from "./clients";
import { compareExpenses, getExpenseSummary, getSubscriptions, listExpenses } from "./expenses";
import {
  getAccountBalances,
  getFinancialSummary,
  getIncomeSummary,
  getRecurringRevenue,
  getTaxPosition,
} from "./income";
import { getDateTime } from "./time";
import type { Tool } from "./types";
import { addCompanyBillsTool } from "./write-bills";
import { createExpense, updateExpenseTool } from "./write-expense";
import { recordClientPayment, updateClientPayment } from "./write-payment";

/**
 * Every operation the assistant can perform. The model only chooses among
 * these and fills in their arguments; it never sees the database or writes SQL.
 * Adding a capability means adding a tool here, with its own schema,
 * permission and server-side validation.
 */
export const TOOLS: Tool[] = [
  getExpenseSummary,
  compareExpenses,
  listExpenses,
  getSubscriptions,
  listClients,
  getClientOverview,
  getClientPayments,
  getReceivables,
  getUpcomingPayments,
  getIncomeSummary,
  getRecurringRevenue,
  getTaxPosition,
  getAccountBalances,
  getFinancialSummary,
  listCompanyBills,
  getDateTime,
  createExpense,
  updateExpenseTool,
  recordClientPayment,
  updateClientPayment,
  addCompanyBillsTool,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

type JsonSchema = Record<string, unknown>;

/** Keywords strict function calling does not accept; the server validates them instead. */
const UNSUPPORTED = new Set(["$schema", "minLength", "maxLength"]);

/**
 * A parameter schema in OpenAI's strict form: every property is listed as
 * required but may be null, and nothing else is allowed. The model then sends
 * null for whatever the user did not mention (clean() drops nulls) instead of
 * inventing a value, and its arguments are always valid JSON for the schema.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = Object.fromEntries(Object.entries(schema).filter(([key]) => !UNSUPPORTED.has(key)));
  if (out.type === "object") {
    const properties = (out.properties as Record<string, JsonSchema> | undefined) ?? {};
    out.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, nullable(strictSchema(value))]));
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  if (out.type === "array" && out.items) out.items = strictSchema(out.items as JsonSchema);
  return out;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema.enum)) return { ...schema, type: [schema.type, "null"], enum: [...(schema.enum as unknown[]), null] };
  if (typeof schema.type === "string") return { ...schema, type: [schema.type, "null"] };
  if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: [...(schema.anyOf as unknown[]), { type: "null" }] };
  return schema;
}

/** The function definitions sent to the model, built from each tool's schema. */
export function toolDefinitions(tools: Tool[] = TOOLS): ToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: strictSchema(z.toJSONSchema(tool.schema) as JsonSchema),
      strict: true,
    },
  }));
}

/** Whether this person may use the tool. Checked on every run, never left to the prompt. */
export function mayUse(tool: Tool, isAdmin: boolean): boolean {
  return tool.permission === "member" || isAdmin;
}
