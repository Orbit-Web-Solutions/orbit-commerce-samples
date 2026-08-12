import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { OrbitClient } from "@orbitcommerce/sdk";

/**
 * Auth and crypto helpers, kept deliberately visible.
 *
 * In our own plugins these live behind a shared package. They are written out
 * here because a sample should not hide the two things you most need to get
 * right: how a token is obtained, and how it is stored.
 *
 * `exchangeSessionToken` and `refreshAccessToken` are thin wrappers over
 * `@orbitcommerce/sdk`. The crypto is standard AES-256-GCM.
 */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Trade the short-lived session token the dashboard handed your page for a
 * long-lived pair. POSTs to `/oauth/token/exchange`.
 */
export function exchangeSessionToken(sessionToken: string): Promise<TokenPair> {
  return OrbitClient.exchangeToken(sessionToken);
}

/**
 * Rotate the pair. POSTs to `/oauth/token/refresh`.
 *
 * The refresh token you pass in is invalidated by this call and the response
 * carries its replacement — persist it. See `connection.ts`.
 */
export function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  return OrbitClient.refreshToken(refreshToken);
}

export interface PluginContext {
  storeId: string;
  pluginId: string;
  scopes: string[];
  token: string;
}

/** Thrown for any request we will not act on. Callers map it to a 401. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(`Unauthorized: ${message}`);
    this.name = "UnauthorizedError";
  }
}

/**
 * Verify an inbound token and return what it is actually for.
 *
 * This asks the Orbit API rather than decoding the JWT locally. Decoding tells
 * you what a token claims; only the API can tell you it has not been revoked.
 * For anything that matters, ask.
 *
 * Every failure — missing header, malformed token, expired, revoked, or the
 * API declining it — comes back as the same `UnauthorizedError`. That is
 * deliberate on both counts: a rejected caller is a 401, not a 500, and
 * telling them *which* way their token was wrong is free reconnaissance.
 */
export async function verifyRequest(
  authorizationHeader: string | null,
): Promise<PluginContext> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("no bearer token");
  }

  const token = authorizationHeader.slice(7);

  let claims: Awaited<ReturnType<typeof OrbitClient.verifyToken>>;
  try {
    claims = await OrbitClient.verifyToken(token);
  } catch {
    // Includes a token the API rejected outright. Without this the caller
    // would see a 500, which reads as "we are broken" rather than "you are
    // not authorised".
    throw new UnauthorizedError("token could not be verified");
  }

  if (!claims?.storeId) {
    throw new UnauthorizedError("token carries no store");
  }

  return {
    storeId: claims.storeId,
    pluginId: claims.pluginId,
    scopes: claims.scopes,
    token,
  };
}

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;

  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENCRYPTION_KEY must be set in production");
    }
    // Development only, so the sample runs with no setup. Never ship this
    // path — a predictable key is the same as no encryption.
    return createHash("sha256").update("orbit-sample-dev-key").digest();
  }

  const buffer = Buffer.from(key, "hex");
  if (buffer.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes) — try: openssl rand -hex 32",
    );
  }
  return buffer;
}

/** Returns base64(iv + ciphertext + authTag). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64",
  );
}

export function decrypt(encoded: string): string {
  const combined = Buffer.from(encoded, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(
    IV_LENGTH,
    combined.length - AUTH_TAG_LENGTH,
  );

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf-8");
}

// ---------------------------------------------------------------------------
// Inbound webhooks
// ---------------------------------------------------------------------------

export interface WebhookEnvelope {
  id: string;
  topic: string;
  created_at: string;
  store_id: string;
  data: Record<string, unknown>;
}

/**
 * Verify an inbound webhook before trusting a byte of it.
 *
 * Your webhook URL is a public endpoint that anyone can POST to. The signature
 * is the only thing separating a real Orbit delivery from someone who guessed
 * your URL, so verify before you parse, and never act on an unverified body.
 *
 * The comparison is timing-safe: comparing with `===` leaks how much of a
 * forged signature was correct, which is enough to recover a valid one.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): { valid: boolean; envelope: WebhookEnvelope | null; error?: string } {
  if (!signature) {
    return { valid: false, envelope: null, error: "Missing signature header" };
  }
  if (!secret) {
    return { valid: false, envelope: null, error: "WEBHOOK_SECRET is not set" };
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  if (expected.length !== signature.length) {
    return { valid: false, envelope: null, error: "Invalid signature" };
  }
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return { valid: false, envelope: null, error: "Invalid signature" };
  }

  try {
    return { valid: true, envelope: JSON.parse(rawBody) as WebhookEnvelope };
  } catch {
    return { valid: false, envelope: null, error: "Body is not valid JSON" };
  }
}
