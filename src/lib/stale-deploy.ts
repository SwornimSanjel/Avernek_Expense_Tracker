/**
 * After a deploy, a browser tab that was already open still runs the old
 * version of the app. Its next navigation or form submit asks the server for
 * code chunks or server actions that no longer exist, and Next.js throws.
 * Those errors are not bugs — a fresh load of the page fixes them — so the
 * error screens recognise them and reload once, automatically.
 */

const STALE_PATTERNS = [
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to find Server Action/i,
  /Server Action .* was not found/i,
  /Cannot read properties of undefined \(reading 'call'\)/i,
];

export function isStaleDeployError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return STALE_PATTERNS.some((pattern) => pattern.test(text));
}

const KEY = "avernek-stale-reload";

/**
 * Reload once per page. Returns false when a reload was already tried in the
 * last 30 seconds, so a real, repeating error is shown instead of looping.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still reload, the browser keeps us from looping fast.
  }
  window.location.reload();
  return true;
}
