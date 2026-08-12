import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { encrypt, decrypt } from "./orbit-auth";

/**
 * Where a store's Orbit credentials live between processes.
 *
 * The connect page (a web request) writes; the worker (a separate, long-running
 * process) reads. That is the only reason this abstraction exists — the two
 * halves of an integration do not share memory, so the tokens must be durable
 * somewhere both can reach.
 *
 * The file-backed implementation below keeps this sample runnable with no
 * database. **Replace it with your own storage in a real connector** — the
 * shape is deliberately tiny so that swapping in Postgres, SQL Server or
 * whatever your service already uses is a single class.
 */
export interface StoredConnection {
  storeId: string;
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  get(storeId: string): Promise<StoredConnection | null>;
  put(connection: StoredConnection): Promise<void>;
}

/**
 * Tokens are encrypted at rest (AES-256-GCM, see `orbit-auth.ts`),
 * which read `TOKEN_ENCRYPTION_KEY`. This is not optional dressing for a
 * sample: a leaked refresh token is a 90-day key to the merchant's store, and
 * it is the single most valuable thing your integration holds.
 */
export class FileTokenStore implements TokenStore {
  constructor(
    private readonly path: string = resolve(".data/connections.json"),
  ) {}

  private readAll(): Record<
    string,
    { accessToken: string; refreshToken: string }
  > {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      return {};
    }
  }

  async get(storeId: string): Promise<StoredConnection | null> {
    const row = this.readAll()[storeId];
    if (!row) return null;

    try {
      return {
        storeId,
        accessToken: decrypt(row.accessToken),
        refreshToken: row.refreshToken ? decrypt(row.refreshToken) : "",
      };
    } catch {
      // The encryption key changed since this was written. The stored bytes are
      // unrecoverable, so the merchant has to reopen the plugin to reconnect.
      return null;
    }
  }

  async put(connection: StoredConnection): Promise<void> {
    const all = this.readAll();
    all[connection.storeId] = {
      accessToken: encrypt(connection.accessToken),
      refreshToken: connection.refreshToken
        ? encrypt(connection.refreshToken)
        : "",
    };

    mkdirSync(dirname(this.path), { recursive: true });
    // Written whole. A partial write here loses the rotated refresh token and
    // locks the integration out — see the warning in connection.ts.
    writeFileSync(this.path, JSON.stringify(all, null, 2), "utf8");
  }
}
