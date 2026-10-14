"use client";

import { useEffect, useState } from "react";
import { isStaleDeployError, reloadForNewVersion } from "@/lib/stale-deploy";

/**
 * Shown instead of a blank "Application error" screen when a page fails in
 * the browser. If the failure is only an old tab meeting a new deploy, the
 * page reloads itself onto the new version.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const stale = isStaleDeployError(error);
  const [reloading, setReloading] = useState(stale);

  useEffect(() => {
    if (stale && !reloadForNewVersion()) setReloading(false);
    console.error(error);
  }, [error, stale]);

  if (reloading) {
    return (
      <div className="app-error">
        <div className="app-error-card">
          <span className="uploader-spinner app-error-spinner" />
          <h1>Updating to the latest version…</h1>
          <p>The app was just updated. Reloading this page — nothing you saved is lost.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-error">
      <div className="app-error-card">
        <h1>This page hit a problem</h1>
        <p>
          {stale
            ? "The app was updated while this tab was open. Reload to continue."
            : "Something went wrong while showing this page. Your saved data is safe."}
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary !h-11 !px-5">
            Reload page
          </button>
          {!stale && (
            <button type="button" onClick={reset} className="btn !h-11 !px-5">
              Try again
            </button>
          )}
        </div>
        <details className="app-error-details">
          <summary>Technical details</summary>
          <code>
            {error.name}: {error.message}
            {error.digest ? `\nRef: ${error.digest}` : ""}
          </code>
        </details>
      </div>
    </div>
  );
}
