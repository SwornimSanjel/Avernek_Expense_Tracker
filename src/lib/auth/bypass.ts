/**
 * Emergency authentication bypass.
 *
 * Temporary owner-requested bypass. Keeping the switch in one small file makes
 * restoring the normal login a one-line change after account access is fixed.
 *
 * SECURITY: while this is true, every visitor is treated as the database admin.
 */
export function isAuthBypassEnabled(): boolean {
  return true;
}
