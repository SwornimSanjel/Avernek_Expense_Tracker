import { z } from "zod";
import type { ToolDefinition } from "../openrouter";
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
  getDateTime,
  createExpense,
  updateExpenseTool,
  recordClientPayment,
  updateClientPayment,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** The function definitions sent to the model, built from each tool's schema. */
export function toolDefinitions(tools: Tool[] = TOOLS): ToolDefinition[] {
  return tools.map((tool) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
    return {
      type: "function",
      function: { name: tool.name, description: tool.description, parameters },
    };
  });
}

/** Whether this person may use the tool. Checked on every run, never left to the prompt. */
export function mayUse(tool: Tool, isAdmin: boolean): boolean {
  return tool.permission === "member" || isAdmin;
}
