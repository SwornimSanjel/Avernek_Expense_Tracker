/**
 * Signed session cookies.
 *
 * Sessions live entirely in an HMAC-signed cookie. Nothing to redirect to, no
 * external service, and no database round trip to answer "is this user signed
 * in?" — which is what lets middleware gate every request cheaply.
 *
 * Built on Web Crypto rather than node:crypto so the same code runs in
 * middleware (edge runtime) and in server components (Node).
 *
 * The payload is signed, NOT encrypted: it is readable by anyone holding the
 * cookie. Keep it to identity, never secrets.
 */

export const SESSION_COOKIE = "avernek_session";

/** Seven days. Long enough not to nag an internal team, short enough to bound a stolen cookie. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type Session = {
  /** users.id */
  sub: string;
  email: string;
  name: string;
  isAdmin: boolean;
  /** Unix seconds. */
  exp: number;
};

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Backed by an explicit ArrayBuffer so the result satisfies BufferSource —
// a plain `new Uint8Array(n)` is typed over ArrayBufferLike, which crypto.subtle
// will not accept.
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signingKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET?.trim();

  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. " +
        "Generate one with: openssl rand -hex 32"
    );
  }

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Produce "<payload>.<signature>". */
export async function signSession(
  session: Omit<Session, "exp"> & { exp?: number }
): Promise<string> {
  const payload: Session = {
    ...session,
    exp: session.exp ?? Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };

  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    encoder.encode(body)
  );

  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify and decode. Returns null for anything not currently valid — bad
 * signature, tampering, malformed, or expired. Callers only need the null check.
 */
export async function verifySession(
  token: string | undefined | null
): Promise<Session | null> {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      base64UrlToBytes(signature),
      encoder.encode(body)
    );
    if (!valid) return null;

    const session = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(body))
    ) as Session;

    if (typeof session.sub !== "string" || typeof session.exp !== "number") {
      return null;
    }
    if (session.exp * 1000 < Date.now()) return null;

    return session;
  } catch {
    // Malformed base64, malformed JSON, or a missing secret. Treat every one
    // of them as "not signed in" rather than surfacing a 500 on the login page.
    return null;
  }
}
