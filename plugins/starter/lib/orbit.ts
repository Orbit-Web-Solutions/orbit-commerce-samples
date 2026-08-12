import { OrbitClient } from "@orbitcommerce/sdk";

import { getConnection } from "./connection";
import { encrypt } from "./orbit-auth";
import { db } from "./db";

/**
 * Build an SDK client for a store from its stored credentials.
 *
 * **Read this file first.** Everything about keeping a long-running plugin
 * alive is here, and it is about ten lines.
 *
 * `fromRefreshToken` refreshes the access token before it expires and calls
 * `onTokenRefreshed` with the new pair. That callback is where you persist,
 * and it is not optional.
 *
 * ## Why the callback matters more than it looks
 *
 * A refresh **rotates** the pair: the refresh token it consumed is invalidated
 * server-side the moment the API answers, and the response carries its
 * replacement. Omit the callback and everything still works — for an hour.
 * Then the process restarts, presents the refresh token it saved before the
 * rotation, and gets a 401 it can never recover from. The merchant has to
 * reinstall.
 *
 * The failure is silent when you cause it and only shows up later, usually on
 * something nobody is watching. Two of our own plugins shipped this bug.
 *
 * Two corollaries:
 *
 * - **Only one process may hold a store's refresh token.** Two workers
 *   refreshing concurrently means one ends up holding a dead one. Elect a
 *   leader rather than running redundant copies.
 * - **A 401 from the refresh itself is terminal.** Retrying cannot recover it;
 *   surface it to a human.
 */
export async function clientForStore(
  storeId: string,
): Promise<OrbitClient | null> {
  const connection = await getConnection(storeId);

  // No usable credential. Not transient — the merchant must reopen the plugin
  // so a fresh session token can be exchanged.
  if (!connection?.refreshToken) return null;

  return OrbitClient.fromRefreshToken({
    token: connection.accessToken,
    refreshToken: connection.refreshToken,
    storeId,
    apiUrl: process.env.ORBIT_API_URL,
    onTokenRefreshed: async (tokens) => {
      await db.connection.update({
        where: { storeId },
        data: {
          accessToken: encrypt(tokens.accessToken),
          // Keep the existing one if the response carried none, so a partial
          // response can never blank out a working credential.
          refreshToken: encrypt(tokens.refreshToken ?? connection.refreshToken),
        },
      });
    },
  });
}
