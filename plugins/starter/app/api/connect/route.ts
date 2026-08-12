import { NextRequest, NextResponse } from "next/server";

import { verifyRequest, UnauthorizedError } from "../../../lib/orbit-auth";
import { saveConnection, getConnection } from "../../../lib/connection";
import {
  ensureSubscriptions,
  type SubscriptionResult,
} from "../../../lib/webhooks";

/** Where Orbit should POST events. Must be HTTPS and reachable from outside. */
const WEBHOOK_URL = process.env.ORBIT_WEBHOOK_URL;
const TOPICS = ["order.created", "order.updated"];

/**
 * The handshake, and the only part of this plugin a browser strictly needs.
 *
 * The embed calls it on load with the session token the dashboard handed it,
 * and it trades that for the durable pair everything else runs on.
 *
 * `verifyRequest` asks the Orbit API to validate the token rather than
 * decoding it locally, and returns the store it belongs to — never take a
 * store id from the request itself.
 */
export async function POST(request: NextRequest) {
  try {
    const context = await verifyRequest(request.headers.get("Authorization"));

    await saveConnection(context.storeId, context.token);

    // Subscribing here means it happens once, at connect, with a credential we
    // already hold — and ensureSubscriptions skips what exists, so reopening
    // the plugin does not duplicate anything.
    let webhooks: SubscriptionResult | null = null;
    if (WEBHOOK_URL) {
      const connection = await getConnection(context.storeId);
      if (connection) {
        webhooks = await ensureSubscriptions(
          connection.accessToken,
          WEBHOOK_URL,
          TOPICS,
        );
      }
    }

    return NextResponse.json({
      connected: true,
      storeId: context.storeId,
      scopes: context.scopes,
      webhooks,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Never echo the token or a raw error back to the client.
    console.error("[starter] connect failed", error);
    return NextResponse.json({ error: "Failed to connect" }, { status: 500 });
  }
}
