import { exchangeSessionToken, refreshAccessToken } from "./orbit-auth";

import { isExpiring } from "./jwt-utils";
import type { TokenStore } from "./token-store";

/**
 * The Orbit token lifecycle, start to finish. This is the file to read first.
 *
 * ## How a background integration gets a credential
 *
 * There is no API key to paste into a config file. Credentials come from an
 * install, and the handshake goes:
 *
 *   1. The merchant installs your app and opens it. Your page loads inside
 *      their dashboard, which posts it a SHORT-LIVED session token.
 *   2. Your page sends that token to your backend, which calls
 *      `exchangeSessionToken` to trade it for a long-lived access + refresh
 *      pair (`saveConnection` below).
 *   3. You store that pair encrypted. From here your background worker runs
 *      with no browser involved — for as long as it keeps refreshing.
 *
 * Step 1 is the only part that needs a page, and the page needs to do nothing
 * else. See `app/embed/page.tsx`.
 */
export class OrbitConnection {
  constructor(private readonly store: TokenStore) {}

  /**
   * Trade the embed's session token for a durable pair and persist it.
   *
   * Safe to call on every load of the connect page — it simply refreshes what
   * is stored, which also gives the merchant an obvious way to repair a
   * connection that has gone stale.
   */
  async save(storeId: string, sessionToken: string): Promise<void> {
    const tokens = await exchangeSessionToken(sessionToken);
    await this.store.put({
      storeId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? "",
    });
  }

  /**
   * A currently-valid access token for the store, refreshing when it is close
   * to expiry. Returns null when there is no usable connection, which means a
   * human has to reopen the plugin — your worker cannot recover on its own.
   *
   * ## The part that bites people
   *
   * **A refresh rotates the pair.** The refresh token you just used is dead the
   * moment the API answers, and the response carries its replacement. If you
   * do not persist that replacement, your next refresh presents a token the
   * server has already invalidated and every call fails with 401 — with no way
   * back except reinstalling.
   *
   * That failure is silent at the time it is caused and only surfaces an hour
   * later, when the access token expires. Two of our own connectors shipped
   * this bug. So: persist BEFORE returning, and treat a 401 on refresh as
   * "credential lost, tell a human", never as something to retry.
   *
   * The same reasoning forbids two workers sharing one connection. Only one
   * process may hold a refresh token; if two refresh concurrently, the loser
   * holds a dead one.
   */
  async accessToken(storeId: string): Promise<string | null> {
    const connection = await this.store.get(storeId);
    if (!connection) return null;

    if (!isExpiring(connection.accessToken)) return connection.accessToken;
    if (!connection.refreshToken) return null;

    const rotated = await refreshAccessToken(connection.refreshToken);

    await this.store.put({
      storeId,
      accessToken: rotated.accessToken,
      // Keep the old one only if the API returned nothing new, so a partial
      // response can never blank out a working credential.
      refreshToken: rotated.refreshToken ?? connection.refreshToken,
    });

    return rotated.accessToken;
  }
}
