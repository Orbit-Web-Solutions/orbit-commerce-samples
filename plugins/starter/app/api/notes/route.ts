import { NextRequest, NextResponse } from "next/server";

import { verifyRequest, UnauthorizedError } from "../../../lib/orbit-auth";
import { db } from "../../../lib/db";

/**
 * CRUD against the plugin's own database.
 *
 * Notes are a stand-in for whatever your plugin actually stores. The point is
 * the shape: **every query is filtered by the store id from the verified
 * token**, never by one the caller supplied.
 *
 * Forget that filter on one query and you have not built a bug, you have built
 * a cross-tenant data leak.
 */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );

    const notes = await db.note.findMany({
      where: { storeId }, // <- the filter that matters
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ notes });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );
    const { body } = await request.json();

    if (typeof body !== "string" || body.trim() === "") {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const note = await db.note.create({
      data: { storeId, body: body.slice(0, 500) },
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );
    const id = new URL(request.url).searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // deleteMany with BOTH id and storeId, not delete by id. Deleting by id
    // alone would let one merchant remove another's record by guessing a uuid.
    const { count } = await db.note.deleteMany({ where: { id, storeId } });

    return NextResponse.json({ deleted: count });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  // Anything else really is our fault. Log it; do not echo it to the caller.
  console.error("[starter]", error);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
