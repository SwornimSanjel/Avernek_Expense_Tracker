"use client";

import { useEffect } from "react";
import { isStaleDeployError, reloadForNewVersion } from "@/lib/stale-deploy";
import "./globals.css";

/**
 * Last-resort screen for errors outside every page (the root layout itself).
 * Same rule as the page-level screen: an old tab after a deploy just reloads.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const stale = isStaleDeployError(error);

  useEffect(() => {
    if (stale) reloadForNewVersion();
    console.error(error);
  }, [error, stale]);

  return (
    <html lang="en" data-theme="dark">
      <body>
        <div className="app-error">
          <div className="app-error-card">
            <h1>{stale ? "Updating to the latest version…" : "Something went wrong"}</h1>
            <p>
              {stale
                ? "The app was just updated. Reloading — nothing you saved is lost."
                : "The app could not load this page. Your saved data is safe."}
            </p>
            <button type="button" onClick={() => window.location.reload()} className="btn btn-primary !h-11 !px-5 mt-5">
              Reload page
            </button>
            <details className="app-error-details">
              <summary>Technical details</summary>
              <code>
                {error.name}: {error.message}
                {error.digest ? `\nRef: ${error.digest}` : ""}
              </code>
            </details>
          </div>
        </div>
      </body>
    </html>
  );
}
