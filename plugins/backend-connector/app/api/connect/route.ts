import { NextRequest, NextResponse } from "next/server";

import { verifyRequest } from "../../../lib/orbit-auth";
import { OrbitConnection } from "../../../lib/connection";
import { FileTokenStore } from "../../../lib/token-store";
import { OrbitApi } from "../../../lib/orbit-api";
import { ensureSubscriptions } from "../../../lib/webhooks";

/** Where Orbit should POST events. Must be HTTPS and reachable from outside. */
const WEBHOOK_URL = process.env.ORBIT_WEBHOOK_URL;
const TOPICS = ["order.created", "order.updated"];

/**
 * The handshake endpoint, and the only part of this integration a browser ever
 * touches. The connect page calls it on load with the session token the
 * dashboard handed it, and it trades that for the durable pair the worker runs
 * on.
 *
 * `verifyRequest` asks the Orbit API to validate the token rather than
 * decoding it locally, and returns the store it belongs to — never take a
 * store id from the request itself.
 */
export async function POST(request: NextRequest) {
  try {
    const context = await verifyRequest(request.headers.get("Authorization"));
    const connection = new OrbitConnection(new FileTokenStore());

    await connection.save(context.storeId, context.token);

    // Subscribing here rather than in the worker means it happens once, at
    // install, with a token we already hold — and `ensureSubscriptions` skips
    // what already exists, so reopening the plugin does not duplicate them.
    let webhooks: { created: string[]; existing: string[] } | null = null;
    if (WEBHOOK_URL) {
      const accessToken = await connection.accessToken(context.storeId);
      if (accessToken) {
        webhooks = await ensureSubscriptions(
          new OrbitApi(accessToken),
          WEBHOOK_URL,
          TOPICS,
        );
      }
    }

    return NextResponse.json({
      connected: true,
      storeId: context.storeId,
      webhooks,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect";
    const status = message.startsWith("Unauthorized") ? 401 : 500;

    // Never echo the token or the raw error back to the client.
    return NextResponse.json({ error: message }, { status });
  }
}
