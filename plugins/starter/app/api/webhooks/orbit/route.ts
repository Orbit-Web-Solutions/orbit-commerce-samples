import { NextRequest, NextResponse } from "next/server";

import { verifyWebhookSignature } from "../../../../lib/orbit-auth";
import { db } from "../../../../lib/db";

/**
 * Receives events Orbit pushes to you.
 *
 * This is a public endpoint — anyone can POST to it — so the signature is the
 * only thing that makes the body trustworthy. Verify first, parse second, act
 * third.
 *
 * ## Answer fast, work later
 *
 * Orbit retries on failure and gives up if you are slow, so a handler that
 * does real work inline turns a slow database into lost events. Record the
 * event, return 200, process it afterwards. This route records and returns;
 * the worker picks the rows up.
 *
 * ## Deliveries repeat
 *
 * Delivery is at-least-once: a network blip on our side means you see the same
 * event twice. The unique constraint on `eventId` absorbs that — the second
 * delivery collides and is acknowledged without doing the work again. Design
 * for redelivery rather than hoping it does not happen.
 */
export async function POST(request: NextRequest) {
  // Read the RAW body. Parsing first and re-serialising changes the bytes and
  // the signature no longer matches.
  const rawBody = await request.text();

  const result = verifyWebhookSignature(
    rawBody,
    request.headers.get("X-Orbit-Webhook-Signature"),
    process.env.WEBHOOK_SECRET ?? "",
  );

  if (!result.valid || !result.envelope) {
    // 401, not 500: this is a rejected caller, not a broken handler.
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const { id, topic, store_id: storeId } = result.envelope;

  try {
    await db.webhookEvent.create({ data: { eventId: id, storeId, topic } });
  } catch {
    // Almost certainly the unique constraint: we have seen this event before.
    // Acknowledge it — retrying would not help either side.
    return NextResponse.json({ received: true, duplicate: true });
  }

  return NextResponse.json({ received: true });
}
