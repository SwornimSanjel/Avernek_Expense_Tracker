/**
 * Matching what someone typed or said ("kalika", "Kalika Technical Pvt. Ltd.")
 * against names in the books: clients, categories, vendors, people, accounts.
 *
 * The rule the assistant follows: pick automatically only when exactly one
 * record fits; otherwise ask. A name it is unsure of is never guessed.
 */

const NOISE = new Set(["pvt", "ltd", "private", "limited", "the", "co", "company", "inc", "llc"]);

/** Lowercase, accents and punctuation removed, company suffixes dropped. */
export function normalizeName(value: string | null | undefined): string {
  const words = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const meaningful = words.filter((word) => !NOISE.has(word));
  return (meaningful.length ? meaningful : words).join(" ");
}

export type MatchResult<T> =
  | { kind: "one"; item: T }
  | { kind: "many"; items: T[] }
  | { kind: "none" };

/**
 * One item when the query names exactly one (an exact match, or the only item
 * containing every word of the query as the start of one of its words);
 * several when it is ambiguous; none when nothing fits.
 */
export function matchOne<T>(items: T[], namesOf: (item: T) => (string | null | undefined)[], query: string): MatchResult<T> {
  const wanted = normalizeName(query);
  if (!wanted) return { kind: "none" };
  const tokens = wanted.split(" ");

  const exact: T[] = [];
  const partial: T[] = [];
  for (const item of items) {
    const names = namesOf(item).map(normalizeName).filter(Boolean);
    if (names.includes(wanted)) {
      exact.push(item);
      continue;
    }
    const fits = names.some((name) => {
      const words = name.split(" ");
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    });
    if (fits) partial.push(item);
  }

  if (exact.length === 1) return { kind: "one", item: exact[0] };
  if (exact.length > 1) return { kind: "many", items: exact };
  if (partial.length === 1) return { kind: "one", item: partial[0] };
  if (partial.length > 1) return { kind: "many", items: partial };
  return { kind: "none" };
}
