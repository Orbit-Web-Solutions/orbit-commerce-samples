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
 * whole point of this sample: the web app exists only to capture credentials
 * during install, and this process does the actual work, for as long as it
 * keeps refreshing its tokens. They share nothing but the token store.
 *
 * Run it with:  npm run worker
 */

const STORE_ID = process.env.ORBIT_STORE_ID;
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 5 * 60 * 1000);
const CHECKPOINT = resolve(".data/checkpoint.json");

function readCheckpoint(): Date {
  try {
    return new Date(JSON.parse(readFileSync(CHECKPOINT, "utf8")).since);
  } catch {
    // First run: look back a day rather than pulling the entire order history.
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
  }
}

function writeCheckpoint(since: Date): void {
  mkdirSync(dirname(CHECKPOINT), { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify({ since: since.toISOString() }));
}

async function tick(connection: OrbitConnection, erp: InMemoryErpClient) {
  const since = readCheckpoint();

  // Stamped BEFORE the call, not after: anything that changes while the sync
  // runs must fall inside the next window rather than into the gap between
  // them. Overlapping slightly is harmless because the ERP upsert is
  // idempotent; a gap loses orders silently.
  const startedAt = new Date();

  try {
    const result = await runSync(STORE_ID!, connection, erp, since);

    if (result.needsReconnect) {
      console.error(
        "[sample-connector] no usable credential for store",
        STORE_ID,
        "— the merchant must reopen the plugin to reconnect. Not retrying.",
      );
      return;
    }

    writeCheckpoint(startedAt);
    console.log(
      `[sample-connector] pulled ${result.ordersPulled} orders, pushed ${result.stockPushed} stock levels`,
    );
  } catch (error) {
    // The checkpoint is deliberately NOT advanced here, so the next pass
    // re-covers this window.
    console.error(
      `[sample-connector] sync failed (${isRetryable(error) ? "will retry" : "not retryable"}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function main() {
  if (!STORE_ID) {
    console.error(
      "ORBIT_STORE_ID is not set. Install the plugin on a store first, then copy the store id from the connect page.",
    );
    process.exit(1);
  }

  const connection = new OrbitConnection(new FileTokenStore());
  const erp = new InMemoryErpClient([{ sku: "DEMO-001", quantity: 42 }]);

  console.log(
    `[sample-connector] syncing store ${STORE_ID} every ${INTERVAL_MS}ms`,
  );

  await tick(connection, erp);
  setInterval(() => void tick(connection, erp), INTERVAL_MS);
}

// Only one process may hold a refresh token — see connection.ts. If you run
// this redundantly, elect a single leader rather than starting two copies.
void main();
