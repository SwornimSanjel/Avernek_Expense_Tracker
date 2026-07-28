export const APP_OWNER_EMAIL = "xettrikenzon@gmail.com";

/** Team members may sign in, but only this account manages existing records. */
export function isAppOwner(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === APP_OWNER_EMAIL;
}

export function canManageExpenses(email: string | null | undefined): boolean {
  return isAppOwner(email);
}

export function assertAppOwner(email: string | null | undefined): void {
  if (!isAppOwner(email)) {
    throw new Error("Only Swornim can edit, delete, or change protected settings.");
  }
}

export const assertCanManageExpenses = assertAppOwner;
