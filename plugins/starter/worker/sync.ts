import type { OrbitClient } from "@orbitcommerce/sdk";

import { listOrdersUpdatedSince, OrbitRestError } from "../lib/orbit-rest";
import { db } from "../lib/db";
import { getSettings } from "../lib/settings";

export interface SyncResult {
  ordersSeen: number;
  eventsProcessed: number;
  /** Set when the credential is unusable and a human must reconnect. */
  needsReconnect: boolean;
}

/**
 * One pass of background work for one store.
 *
 * Two jobs, standing in for whatever yours does:
 *
 *   - drain webhook events the receiver recorded but has not processed
 *   - poll for orders changed since the last checkpoint
 *
 * Both run with no browser and no user session, using only the credential the
 * connect page stored at install.
 */
export async function runSync(
  storeId: string,
  orbit: OrbitClient | null,
  since: Date,
): Promise<SyncResult> {
  // No usable credential. Not transient — the merchant must reopen the plugin,
  // and retrying cannot fix it.
  if (!orbit) {
    return { ordersSeen: 0, eventsProcessed: 0, needsReconnect: true };
  }

  const settings = await getSettings(storeId);

  // --- drain recorded webhook events ---------------------------------------
  // The receiver answers Orbit immediately and records; the real work happens
  // here, where being slow costs nothing.
  const pending = await db.webhookEvent.findMany({
    where: { storeId, processedAt: null },
    orderBy: { receivedAt: "asc" },
    take: 100,
  });

  for (const event of pending) {
    // ... whatever your plugin does with a `${event.topic}` event.
    await db.webhookEvent.update({
      where: { eventId: event.eventId },
      data: { processedAt: new Date() },
    });
  }

  // --- poll for anything webhooks missed -----------------------------------
  // Direct REST: the SDK's OrdersService has only create(), no list.
  const { items: orders } = await listOrdersUpdatedSince(
    orbit.getToken()!,
    since,
  );

  // --- optional write back --------------------------------------------------
  if (settings.writeBackEnabled && orders.length > 0) {
    // Reads go through the SDK, which is typed and unwraps the response
    // envelope for you. It also chunks bulk writes to the API's 50-per-call
    // limit, so you do not have to.
    const products = await orbit.products.list({ page: 1, limit: 1 });
    void products;
  }

  return {
    ordersSeen: orders.length,
    eventsProcessed: pending.length,
    needsReconnect: false,
  };
}

/**
 * Whether a failed pass is worth retrying.
 *
 * Rate limiting and transport errors are transient. A revoked credential is
 * not — retrying burns quota and hides the problem.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof OrbitRestError) {
    return error.isRateLimited || error.status >= 500;
  }
  return true;
}
