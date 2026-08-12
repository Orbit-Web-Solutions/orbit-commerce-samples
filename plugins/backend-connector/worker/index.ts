import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { OrbitConnection } from "../lib/connection";
import { FileTokenStore } from "../lib/token-store";
import { InMemoryErpClient } from "../lib/erp";
import { runSync, isRetryable } from "./sync";

/**
 * The background half of the connector — the part that maps onto a Windows
 * service, a systemd unit, or a scheduled task.
 *
 * It is a SEPARATE PROCESS from the web app in `app/`. That separation is the
 * point of this sample: the web app exists only to capture credentials during
 * install, and this process does the actual work, for as long as it keeps
 * refreshing its tokens. They share nothing but the token store.
 *
 * ## One app, many stores
 *
 * There is no configured store id here, and there should not be one in your
 * connector either. One app serves **every merchant who installs it**, so the
 * worker iterates whatever has connected and keeps per-store state throughout.
 * Merchants appear when they install and stop appearing when their credential
 * is revoked; neither needs a deployment.
 *
 * Even a connector built for a single client is worth writing this way. It
 * costs one loop, and it means the second merchant is a non-event rather than
 * a rewrite.
 *
 * Run it with:  npm run worker
 */

const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 5 * 60 * 1000);

/**
 * Optional development convenience: restrict a run to one store while you are
 * working on it. It is a filter, never the source of truth.
 */
const ONLY_STORE = process.env.ORBIT_STORE_ID;

const CHECKPOINTS = resolve(".data/checkpoints.json");

/** Checkpoints are per store — merchants sync at different rates. */
function readCheckpoints(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CHECKPOINTS, "utf8"));
  } catch {
    return {};
  }
}

function checkpointFor(storeId: string): Date {
  const stored = readCheckpoints()[storeId];
  // First run for this store: look back a day rather than pulling its entire
  // order history.
  return stored ? new Date(stored) : new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function writeCheckpoint(storeId: string, since: Date): void {
  const all = readCheckpoints();
  all[storeId] = since.toISOString();
  mkdirSync(dirname(CHECKPOINTS), { recursive: true });
  writeFileSync(CHECKPOINTS, JSON.stringify(all, null, 2), "utf8");
}

async function syncStore(
  storeId: string,
  connection: OrbitConnection,
  erp: InMemoryErpClient,
): Promise<void> {
  const since = checkpointFor(storeId);

  // Stamped BEFORE the call, not after: anything that changes while the sync
  // runs must fall inside the next window rather than into the gap between
  // them. Overlapping slightly is harmless because the ERP upsert is
  // idempotent; a gap loses orders silently.
  const startedAt = new Date();

  try {
    const result = await runSync(storeId, connection, erp, since);

    if (result.needsReconnect) {
      // One store's credential being gone must not stop the others. Report it
      // and move on — retrying cannot recover it, a human reopening the plugin
      // can.
      console.error(
        `[connector] ${storeId}: no usable credential — the merchant must reopen the plugin. Skipping.`,
      );
      return;
    }

    writeCheckpoint(storeId, startedAt);
    console.log(
      `[connector] ${storeId}: pulled ${result.ordersPulled} orders, pushed ${result.stockPushed} stock levels`,
    );
  } catch (error) {
    // The checkpoint is deliberately NOT advanced, so the next pass re-covers
    // this window for this store only.
    console.error(
      `[connector] ${storeId}: sync failed (${isRetryable(error) ? "will retry" : "not retryable"}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function tick(connection: OrbitConnection, erp: InMemoryErpClient) {
  const store = new FileTokenStore();
  const storeIds = (await store.listStoreIds()).filter(
    (id) => !ONLY_STORE || id === ONLY_STORE,
  );

  if (storeIds.length === 0) {
    console.log(
      "[connector] no connected stores yet — install the plugin on a store and open it once.",
    );
    return;
  }

  // Sequential on purpose. Running stores concurrently multiplies your request
  // rate against a per-install limit you are already sharing, and makes a
  // rate-limit response hard to attribute.
  for (const storeId of storeIds) {
    await syncStore(storeId, connection, erp);
  }
}

async function main() {
  const connection = new OrbitConnection(new FileTokenStore());
  const erp = new InMemoryErpClient([{ sku: "DEMO-001", quantity: 42 }]);

  console.log(
    `[connector] syncing every connected store every ${INTERVAL_MS}ms` +
      (ONLY_STORE ? ` (restricted to ${ONLY_STORE})` : ""),
  );

  await tick(connection, erp);
  setInterval(() => void tick(connection, erp), INTERVAL_MS);
}

// Only one process may hold a store's refresh token — see connection.ts. If you
// run this redundantly, elect a leader rather than starting two copies.
void main();
