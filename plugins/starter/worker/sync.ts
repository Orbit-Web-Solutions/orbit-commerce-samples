import type { OrbitClient } from "@orbitcommerce/sdk";

import { listOrdersUpdatedSince, OrbitRestError } from "../lib/orbit-rest";
import { db } from "../lib/db";
import { checkEntitlement } from "../lib/billing";

export interface SyncResult {
  ordersSeen: number;
  eventsProcessed: number;
  /** What the paid path decided this pass. */
  entitlement?: string;
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

  // --- the part you charge for ---------------------------------------------
  // Checked HERE, on the server, every pass. The embed checks too so the UI
  // can show the right thing, but the embed runs on the merchant's machine.
  // Anything that costs you money is decided somewhere they cannot edit.
  const entitlement = await checkEntitlement(storeId);

  if (entitlement.state === "entitled" && orders.length > 0) {
    // Reads go through the SDK: typed, envelope unwrapped for you, and bulk
    // writes chunked to the API's 50-per-call limit automatically.
    const products = await orbit.products.list({ page: 1, limit: 1 });
    void products; // ... whatever the paid feature actually does
  }

  return {
    ordersSeen: orders.length,
    eventsProcessed: pending.length,
    entitlement: entitlement.state,
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
