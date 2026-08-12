import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { listConnectedStoreIds } from "../lib/connection";
import { clientForStore } from "../lib/orbit";
import { runSync, isRetryable } from "./sync";

/**
 * The background half of the plugin — a scheduled job, a daemon, a Windows
 * service. Whatever your plugin does when nobody is looking.
 *
 * It is a SEPARATE PROCESS from the web app in `app/`. They share only the
 * database. That matters because the web app only runs while a merchant has
 * the plugin open, and most useful work does not.
 *
 * ## One plugin, many stores
 *
 * There is no configured store id here, and there should not be one in yours.
 * A plugin serves **every merchant who installs it**, so the worker iterates
 * whatever has connected and keeps per-store state throughout. Merchants
 * appear when they install and stop appearing when their credential is
 * revoked, with no deployment either way.
 *
 * Run it with:  npm run worker
 */

const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 5 * 60 * 1000);

/** Development convenience: work on one store at a time. Never the mechanism. */
const ONLY_STORE = process.env.ORBIT_STORE_ID;

const CHECKPOINTS = resolve(".data/checkpoints.json");

function readCheckpoints(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CHECKPOINTS, "utf8"));
  } catch {
    return {};
  }
}

function checkpointFor(storeId: string): Date {
  const stored = readCheckpoints()[storeId];
  // First run for this store: look back a day rather than pulling everything.
  return stored ? new Date(stored) : new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function writeCheckpoint(storeId: string, since: Date): void {
  const all = readCheckpoints();
  all[storeId] = since.toISOString();
  mkdirSync(dirname(CHECKPOINTS), { recursive: true });
  writeFileSync(CHECKPOINTS, JSON.stringify(all, null, 2), "utf8");
}

async function syncStore(storeId: string): Promise<void> {
  const since = checkpointFor(storeId);

  // Stamped BEFORE the work, not after: anything that changes while the pass
  // runs must fall into the next window rather than the gap between them. A
  // slight overlap is harmless if your writes are idempotent; a gap loses
  // records silently.
  const startedAt = new Date();

  try {
    const orbit = await clientForStore(storeId);
    const result = await runSync(storeId, orbit, since);

    if (result.needsReconnect) {
      // One store's dead credential must not stop the others.
      console.error(
        `[starter] ${storeId}: no usable credential — the merchant must reopen the plugin. Skipping.`,
      );
      return;
    }

    writeCheckpoint(storeId, startedAt);
    console.log(
      `[starter] ${storeId}: ${result.ordersSeen} orders seen, ${result.eventsProcessed} events processed`,
    );
  } catch (error) {
    // The checkpoint is deliberately NOT advanced, so the next pass re-covers
    // this window — for this store only.
    console.error(
      `[starter] ${storeId}: pass failed (${isRetryable(error) ? "will retry" : "not retryable"}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function tick() {
  const storeIds = (await listConnectedStoreIds()).filter(
    (id) => !ONLY_STORE || id === ONLY_STORE,
  );

  if (storeIds.length === 0) {
    console.log(
      "[starter] no connected stores yet — install the plugin on a store and open it once.",
    );
    return;
  }

  // Sequential on purpose. Stores share a per-installation rate limit, and
  // running them concurrently makes a 429 hard to attribute.
  for (const storeId of storeIds) {
    await syncStore(storeId);
  }
}

async function main() {
  console.log(
    `[starter] running every ${INTERVAL_MS}ms` +
      (ONLY_STORE ? ` (restricted to ${ONLY_STORE})` : ""),
  );

  await tick();
  setInterval(() => void tick(), INTERVAL_MS);
}

// Only one process may hold a store's refresh token — see lib/orbit.ts. If you
// run this redundantly, elect a leader rather than starting two copies.
void main();
