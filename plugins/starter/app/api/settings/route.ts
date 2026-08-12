import { NextRequest, NextResponse } from "next/server";

import { verifyRequest, UnauthorizedError } from "../../../lib/orbit-auth";
import { getSettings, saveSettings } from "../../../lib/settings";

/**
 * Read and write this store's settings.
 *
 * Note what is NOT here: a store id in the request. It comes from the verified
 * token, every time. Accepting one from the caller would let anyone who
 * reached this endpoint read or edit another merchant's configuration — the
 * single most common way a multi-tenant plugin leaks.
 */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );
    return NextResponse.json(await getSettings(storeId));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );
    const body = await request.json();

    // Only fields you recognise. Writing the request body wholesale lets a
    // caller add keys you never intended to store.
    const saved = await saveSettings(storeId, {
      syncIntervalMinutes: clampInterval(body.syncIntervalMinutes),
      label:
        typeof body.label === "string" ? body.label.slice(0, 200) : undefined,
    });

    return NextResponse.json(saved);
  } catch (error) {
    return fail(error);
  }
}

function clampInterval(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.min(Math.max(Math.round(value), 1), 1440);
}

function fail(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  // Anything else really is our fault. Log it; do not echo it to the caller.
  console.error("[starter]", error);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
