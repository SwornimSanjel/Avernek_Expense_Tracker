/**
 * Emergency authentication bypass.
 *
 * Off: every request needs a signed-in session. Keeping the switch in one small
 * file makes an emergency bypass a one-line change, but it must never ship to
 * production while the site is reachable: while this returns true, every
 * visitor is treated as the database admin, including the AI assistant, which
 * can read the books and draft changes.
 */
export function isAuthBypassEnabled(): boolean {
  return false;
}
