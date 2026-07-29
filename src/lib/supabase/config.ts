/**
 * Single source of truth for the Supabase connection.
 *
 * THE THING THAT CATCHES EVERYONE: `NEXT_PUBLIC_*` values are inlined into the
 * JavaScript bundle when `next build` runs. They are not read at runtime.
 * Editing .env and restarting the container changes nothing — the old value is
 * already compiled into the shipped code. Every change here needs a rebuild.
 *
 * `supabaseHost` is exported so /api/health can report which project the
 * running build actually talks to, rather than which one .env claims.
 */

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `${name} is missing or empty. NEXT_PUBLIC_* values are baked in when ` +
        `\`next build\` runs, so it must be set at build time — setting it ` +
        `only at runtime is too late.`
    );
  }
  return trimmed;
}

/**
 * supabase-js appends "/auth/v1/..." and "/rest/v1/..." to this. A trailing
 * slash therefore produces "https://host//auth/v1/token", which some proxies
 * and gateways reject or route differently.
 */
function normalizeUrl(raw: string): string {
  const url = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must start with http:// or https:// (got "${raw}")`
    );
  }
  return url;
}

// Referenced as full literals so the Next.js build can substitute them.
export const SUPABASE_URL = normalizeUrl(
  required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL)
);

export const SUPABASE_ANON_KEY = required(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** Hostname only — safe to expose; the anon key already ships in the bundle. */
export const supabaseHost = (() => {
  try {
    return new URL(SUPABASE_URL).host;
  } catch {
    return "unparseable";
  }
})();
