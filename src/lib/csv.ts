/**
 * CSV downloads that open cleanly in Excel and Google Sheets: a byte-order mark
 * so Excel reads UTF-8 (रु, names with accents), Windows line endings, and
 * quoting only where a cell needs it.
 */

export type CsvCell = string | number | null | undefined;

function cell(value: CsvCell): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Plain number with two decimals, no thousands separators (sums in Excel). */
export function csvMoney(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "";
}

export function csvResponse(filename: string, header: string[], rows: CsvCell[][]): Response {
  const lines = [header, ...rows].map((row) => row.map(cell).join(","));
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** "October 2026" → "october-2026", "2026-01-01 → 2026-03-31" → "2026-01-01-to-2026-03-31". */
export function fileSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/→/g, " to ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
