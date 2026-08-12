import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
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

/**
 * Verify an inbound token and return what it is actually for.
 *
 * This asks the Orbit API rather than decoding the JWT locally. Decoding tells
 * you what a token claims; only the API can tell you it has not been revoked.
 * For anything that matters, ask.
 */
export async function verifyRequest(
  authorizationHeader: string | null
): Promise<PluginContext> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized: no bearer token");
  }

  const token = authorizationHeader.slice(7);
  const claims = await OrbitClient.verifyToken(token);

  return {
    storeId: claims.storeId,
    pluginId: claims.pluginId,
    scopes: claims.scopes,
    token
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
      "TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes) — try: openssl rand -hex 32"
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
    cipher.final()
  ]);

  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64"
  );
}

export function decrypt(encoded: string): string {
  const combined = Buffer.from(encoded, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(
    IV_LENGTH,
    combined.length - AUTH_TAG_LENGTH
  );

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf-8");
}
