import { exchangeSessionToken, encrypt, decrypt } from "./orbit-auth";
import { db } from "./db";

/**
 * The install-time half of the credential story: turning the browser handshake
 * into something a background process can use. Keeping it alive is the SDK's
 * job — see `orbit.ts`.
 *
 * ## Where a credential comes from
 *
 * There is no API key to paste into a config file:
 *
 *   1. The merchant installs your plugin and opens it. Your page loads inside
 *      their dashboard, which posts it a SHORT-LIVED session token.
 *   2. Your page sends that token to your backend, which trades it here for a
 *      long-lived access + refresh pair.
 *   3. You store the pair encrypted, per store. From there your plugin can act
 *      with no browser open at all.
 *
 * Step 1 is the only part that needs a page.
 */
export async function saveConnection(
  storeId: string,
  sessionToken: string,
): Promise<void> {
  const tokens = await exchangeSessionToken(sessionToken);

  const data = {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : "",
  };

  // Upsert, so reopening the plugin repairs a connection that has gone stale
  // rather than failing on a duplicate.
  await db.connection.upsert({
    where: { storeId },
    create: { storeId, ...data },
    update: data,
  });
}

export interface DecryptedConnection {
  storeId: string;
  accessToken: string;
  refreshToken: string;
  settings: Record<string, unknown>;
}

/** Null when the store has never connected, or the encryption key changed. */
export async function getConnection(
  storeId: string,
): Promise<DecryptedConnection | null> {
  const row = await db.connection.findUnique({ where: { storeId } });
  if (!row) return null;

  try {
    return {
      storeId,
      accessToken: decrypt(row.accessToken),
      refreshToken: row.refreshToken ? decrypt(row.refreshToken) : "",
      settings: JSON.parse(row.settings),
    };
  } catch {
    // Unreadable ciphertext means the key rotated. The stored bytes are gone;
    // the merchant has to reopen the plugin to reconnect.
    return null;
  }
}

/** Every store that has connected. One plugin serves many merchants. */
export async function listConnectedStoreIds(): Promise<string[]> {
  const rows = await db.connection.findMany({ select: { storeId: true } });
  return rows.map((r) => r.storeId);
}
