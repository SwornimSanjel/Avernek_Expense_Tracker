import type { AppUser } from "@/lib/types";

/** Columns every people query selects. Never password_hash. */
export const USER_COLUMNS = "id, name, email, is_core_member, is_admin, is_partner";

/**
 * The partners shown in rankings and pickers. Falls back to everyone so a
 * workspace where nobody is flagged yet never shows an empty list.
 */
export function partnersOf<T extends Pick<AppUser, "is_partner">>(users: T[]): T[] {
  const partners = users.filter((user) => user.is_partner);
  return partners.length ? partners : users;
}

/**
 * Picker options: the partners, plus whoever is already on the record being
 * edited — an old expense paid by a login account must keep its payer.
 */
export function pickerPeople<T extends Pick<AppUser, "id" | "is_partner">>(
  users: T[],
  keepIds: (string | null | undefined)[] = []
): T[] {
  const keep = new Set(keepIds.filter(Boolean));
  const partners = partnersOf(users);
  const extra = users.filter((user) => keep.has(user.id) && !partners.includes(user));
  return [...partners, ...extra];
}

/** "Administrator" reads as a role, not a person. */
export function displayName(name: string | null | undefined): string {
  const value = (name ?? "").trim();
  if (!value) return "there";
  if (/^administrator$/i.test(value)) return "Admin";
  return value;
}

export function firstName(name: string | null | undefined): string {
  return displayName(name).split(/\s+/)[0];
}

export function initialsOf(name: string | null | undefined): string {
  return displayName(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
}

/** Stable accent per person, so the same partner has the same colour everywhere. */
const PERSON_TONES = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#22d3ee"];
export function personTone(index: number): string {
  return PERSON_TONES[index % PERSON_TONES.length];
}
