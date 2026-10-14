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

/** Plain-language reason for a save that never got an answer from the server. */
export function describeFailedRequest(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "Could not reach the server — check the internet connection and press Save again. Nothing was saved.";
  }
  if (/unexpected response|body exceeded|payload too large|413/i.test(message)) {
    return `The server refused this upload (${message}). Nothing was saved — try fewer or smaller files.`;
  }
  return `Save failed before it reached the database: ${message || "unknown error"}. Nothing was saved — press Save again.`;
}

/**
 * Wrap a server action for useActionState so a request that fails in transit
 * (offline, proxy rejected it, app just redeployed) becomes a message in the
 * form — picked files stay put — instead of an error screen.
 */
export function guardRequest<S extends { error: string | null; ok: string | null }>(
  action: (previous: S, formData: FormData) => Promise<S>
) {
  return async (previous: S, formData: FormData): Promise<S> => {
    try {
      return await action(previous, formData);
    } catch (error) {
      console.error("[save request failed]", error);
      if (isStaleDeployError(error) && reloadForNewVersion()) {
        return { ...previous, ok: null, error: "The app was just updated — reloading. Please save again." };
      }
      return { ...previous, ok: null, error: describeFailedRequest(error) };
    }
  };
}
