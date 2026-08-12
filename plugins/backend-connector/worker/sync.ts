import {
  OrbitApi,
  OrbitApiError,
  MAX_BULK_UPDATE_ITEMS,
} from "../lib/orbit-api";
import type { OrbitConnection } from "../lib/connection";
import type { ErpClient } from "../lib/erp";

export interface SyncResult {
  ordersPulled: number;
  stockPushed: number;
  /** Set when the connection is unusable and a human must reconnect. */
  needsReconnect: boolean;
}

/**
 * One pass of a two-way sync. Kept deliberately small — the point is the
 * shape, not the feature set:
 *
 *   Orbit → ERP:  orders that changed since the last checkpoint
 *   ERP → Orbit:  stock levels, matched by SKU
 *
 * Everything here runs with no browser and no user session, using only the
 * tokens the connect page stored earlier.
 */
export async function runSync(
  storeId: string,
  connection: OrbitConnection,
  erp: ErpClient,
  since: Date,
): Promise<SyncResult> {
  const accessToken = await connection.accessToken(storeId);

  // No usable credential. This is not a transient failure and retrying will
  // not fix it — the merchant has to reopen the plugin so a fresh session
  // token can be exchanged. Surface it rather than looping.
  if (!accessToken) {
    return { ordersPulled: 0, stockPushed: 0, needsReconnect: true };
  }

  const orbit = new OrbitApi(accessToken);

  // --- Orbit → ERP ---------------------------------------------------------
  const { items: orders } = await orbit.listOrdersUpdatedSince(since);
  for (const order of orders) {
    // Keyed on the Orbit order id so that re-running a window updates rather
    // than duplicates. (Orbit's own `externalId` field runs the other way —
    // it deduplicates orders you push INTO Orbit, and is not returned on read.)
    await erp.upsertOrder({
      externalId: order.id,
      reference: order.orderNumber,
      status: order.status,
      total: Number(order.total),
    });
  }

  // --- ERP → Orbit ---------------------------------------------------------
  const stock = await erp.stockLevels();
  let stockPushed = 0;

  // Your ERP knows SKUs; Orbit knows uuids. One lookup call bridges them.
  const skus = stock.map((s) => s.sku);
  const idBySku = skus.length ? await orbit.lookupProductIds("sku", skus) : {};

  // The stock field is `quantity`. Getting this name wrong does NOT fail —
  // unrecognised body fields are stripped and the call still reports success,
  // so a typo here syncs nothing at all, silently, forever. Verify against a
  // real product the first time you run a new field.
  const updates = stock
    .filter((s) => idBySku[s.sku])
    .map((s) => ({ id: idBySku[s.sku], quantity: s.quantity }));

  // The API caps a batch at 50 and answers 400 above it, so chunk rather than
  // sending the lot. This also keeps you inside the 300-writes-per-minute
  // ceiling on any realistic catalogue.
  for (let i = 0; i < updates.length; i += MAX_BULK_UPDATE_ITEMS) {
    const batch = updates.slice(i, i + MAX_BULK_UPDATE_ITEMS);
    await orbit.bulkUpdateProducts(batch);
    stockPushed += batch.length;
  }

  return { ordersPulled: orders.length, stockPushed, needsReconnect: false };
}

/**
 * Whether a failed pass is worth retrying.
 *
 * Rate limiting and transport errors are transient. A 401 that survived the
 * refresh in `OrbitConnection.accessToken` means the credential itself is
 * gone — retrying burns quota and hides the problem.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof OrbitApiError) {
    return error.isRateLimited || error.status >= 500;
  }
  return true;
}
