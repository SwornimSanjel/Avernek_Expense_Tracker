#!/usr/bin/env node
/**
 * Create (or update) the administrator account from .env.
 *
 *   node scripts/seed-admin.mjs
 *
 * Reads DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD and optionally ADMIN_NAME.
 * Idempotent: re-running resets the admin password to whatever .env says, which
 * is also the recovery path if the password is ever lost.
 *
 * The hash format here MUST stay identical to src/lib/auth/password.ts --
 * scrypt$<salt>$<hash>, 64-byte key, hex encoding -- or seeded accounts cannot
 * sign in.
 */

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import pg from "pg";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// Load .env if the variables are not already exported.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env file; rely on the real environment.
  }
}

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;

const missing = ["DATABASE_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD"].filter(
  (key) => !process.env[key]?.trim()
);

if (missing.length) {
  console.error(`ERROR: missing required variable(s): ${missing.join(", ")}`);
  process.exit(1);
}

if (ADMIN_PASSWORD.length < 10) {
  console.error("ERROR: ADMIN_PASSWORD must be at least 10 characters.");
  process.exit(1);
}

async function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(plain, salt, KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

const email = ADMIN_EMAIL.trim().toLowerCase();
const name = (ADMIN_NAME ?? email.split("@")[0]).trim();

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL?.trim() === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

try {
  await client.connect();

  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  // Matches on lower(email) to line up with users_email_lower_key, so a
  // differently-cased ADMIN_EMAIL updates the existing row instead of
  // colliding with it.
  const { rows } = await client.query(
    `
      insert into public.users (name, email, password_hash, is_admin, is_core_member)
      values ($1, $2, $3, true, true)
      on conflict (lower(email)) do update
        set password_hash  = excluded.password_hash,
            is_admin       = true,
            is_core_member = true,
            name           = coalesce(nullif(public.users.name, ''), excluded.name)
      returning id, email, is_admin, (xmax = 0) as inserted
    `,
    [name, email, passwordHash]
  );

  const admin = rows[0];
  console.log(
    `${admin.inserted ? "Created" : "Updated"} administrator: ${admin.email} (${admin.id})`
  );
  console.log("Sign in at /login with that email and ADMIN_PASSWORD.");
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  if (error.message.includes("users_email_lower_key")) {
    console.error("Run db/migrations/20260729_local_auth.sql first.");
  }
  process.exit(1);
} finally {
  await client.end();
}
