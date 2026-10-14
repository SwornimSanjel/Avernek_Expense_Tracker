import type { Session } from "@/lib/auth/session";

/**
 * Who may change things.
 *
 * Team members can sign in and read everything; only administrators can edit,
 * delete or change protected settings. The flag comes from users.is_admin,
 * carried in the signed session cookie — it used to be a hardcoded email
 * address, which meant changing the owner required a code change and a deploy.
 *
 * Since the RLS policies are gone, these checks are the whole authorization
 * story. Every mutating server action must call assertAppOwner().
 */

export function isAppOwner(session: Session | null | undefined): boolean {
  return session?.isAdmin === true;
}

export const canManageExpenses = isAppOwner;

export function assertAppOwner(session: Session | null | undefined): void {
  if (!isAppOwner(session)) {
    throw new Error(
      "Only an administrator can edit, delete, or change protected settings."
    );
  }
}

export const assertCanManageExpenses = assertAppOwner;
