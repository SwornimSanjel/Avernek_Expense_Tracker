import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * scrypt is deliberately memory-hard, so a leaked table of hashes cannot be
 * brute-forced cheaply on a GPU. No dependency needed, which means one less
 * package in the path of something as sensitive as the login.
 *
 * Server-only: node:crypto does not exist in the edge runtime. Never import
 * this from middleware.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCHEME = "scrypt";

/** Returns "scrypt$<salt>$<hash>" — self-describing, so the scheme can change later. */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error("Cannot hash an empty password");

  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);

  return `${SCHEME}$${salt}$${derived.toString("hex")}`;
}

/** Constant-time verification. False for any malformed stored value. */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!plain || !stored) return false;

  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== SCHEME || !salt || !hash) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const derived = await scryptAsync(plain, salt, KEY_LENGTH);

  // Length is already known equal, so this compares without leaking position
  // of the first differing byte through timing.
  return timingSafeEqual(derived, expected);
}

/**
 * Minimum policy for an internal tool. Length beats character classes: a long
 * passphrase is stronger and likelier to be remembered than "P@ss1".
 */
export function validatePassword(plain: string): string | null {
  if (plain.length < 10) return "Password must be at least 10 characters.";
  if (plain.length > 200) return "Password must be under 200 characters.";
  return null;
}
