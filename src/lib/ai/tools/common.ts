import { z } from "zod";
import { AGREEMENT_STATUS_LABELS, servicesLabel } from "@/lib/income";
import type { Client } from "../data";
import { addDays, daysBetween, formatDate, isValidDate } from "../dates";
import { matchOne } from "../match";
import type { FieldOption } from "../types";
import type { ToolAsk, ToolContext } from "./types";

/** A YYYY-MM-DD calendar date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isValidDate, "Not a real date");

export const explain = z
  .boolean()
  .optional()
  .describe(
    "true only when the user asks why/how, wants analysis, trends or advice. false or omitted for plain figures and lists."
  );

/**
 * Model and form arguments with the empty values removed: models send null or
 * "" for parameters they leave out, and an empty form field means "not given".
 */
export function clean(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args ?? {}).filter(
      ([, value]) => value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "")
    )
  );
}

/** Zod's first problem, worded for a person. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path?.join(".") || "request";
  return `${field}: ${issue?.message ?? "invalid value"}`;
}

/** An inclusive date range, checked; `before` is the exclusive end for filters. */
export function dateRange(from?: unknown, to?: unknown): { from?: string; to?: string; before?: string } | string {
  const start = typeof from === "string" ? from : undefined;
  const end = typeof to === "string" ? to : undefined;
  if (start && end) {
    if (end < start) return `The end date ${formatDate(end)} is before the start date ${formatDate(start)}.`;
    if (daysBetween(start, end) > 366 * 10) return "Ask for at most ten years at a time.";
  }
  return { from: start, to: end, before: end ? addDays(end, 1) : undefined };
}

export function rangeText(from?: string, to?: string): string {
  if (from && to) return from === to ? `on ${formatDate(from)}` : `between ${formatDate(from)} and ${formatDate(to)}`;
  if (from) return `since ${formatDate(from)}`;
  if (to) return `up to ${formatDate(to)}`;
  return "in total";
}

export function clientOption(client: Client): FieldOption {
  const agreement = client.agreements[0];
  const statuses = [...new Set(client.agreements.map((item) => AGREEMENT_STATUS_LABELS[item.status]))].join(", ");
  return {
    value: client.name,
    label: client.name,
    hint: [servicesLabel(agreement), statuses].filter(Boolean).join(" · "),
  };
}

/**
 * The client a request names. Picks one only when exactly one client fits;
 * otherwise returns the choice to show, with every other argument kept.
 */
export async function resolveClient(
  ctx: ToolContext,
  name: string,
  tool: string,
  args: Record<string, unknown>
): Promise<{ client: Client } | ToolAsk> {
  const clients = await ctx.data.clients();
  const match = matchOne(clients, (client) => [client.name, ...client.agreements.map((a) => a.agreement_name)], name);
  if (match.kind === "one") return { client: match.item };

  const options = (match.kind === "many" ? match.items : clients).slice(0, 40).map(clientOption);
  const message =
    match.kind === "many"
      ? `More than one client matches "${name}". Which one do you mean?`
      : `I couldn't find a client called "${name}". Pick the right one:`;
  return {
    status: "needs_choice",
    summary: message,
    form: {
      tool,
      title: "Which client?",
      message,
      values: args,
      fields: [{ name: "client", label: "Client", type: "choice", required: true, options }],
      submitLabel: "Continue",
    },
  };
}

/**
 * The record a typed name refers to (a category, a vendor, a person, an
 * account), or the choice to show when the name fits several or none.
 */
export function resolveRecord<T>(
  items: T[],
  namesOf: (item: T) => (string | null | undefined)[],
  toOption: (item: T) => FieldOption,
  typed: string,
  choice: { tool: string; args: Record<string, unknown>; field: string; label: string }
): { item: T } | ToolAsk {
  const match = matchOne(items, namesOf, typed);
  if (match.kind === "one") return { item: match.item };
  const options = (match.kind === "many" ? match.items : items).map(toOption);
  return choiceOf(choice.tool, choice.args, choice.field, choice.label, typed, options, match.kind === "many");
}

/** A choice between named records (a category, a vendor, …), for a filter or a field. */
export function choiceOf(
  tool: string,
  args: Record<string, unknown>,
  field: string,
  label: string,
  typed: string,
  options: FieldOption[],
  ambiguous: boolean
): ToolAsk {
  const message = ambiguous
    ? `More than one ${label.toLowerCase()} matches "${typed}". Which one?`
    : `There is no ${label.toLowerCase()} called "${typed}". Pick one:`;
  return {
    status: "needs_choice",
    summary: message,
    form: {
      tool,
      title: `Which ${label.toLowerCase()}?`,
      message,
      values: args,
      fields: [{ name: field, label, type: "choice", required: true, options: options.slice(0, 40) }],
      submitLabel: "Continue",
    },
  };
}
