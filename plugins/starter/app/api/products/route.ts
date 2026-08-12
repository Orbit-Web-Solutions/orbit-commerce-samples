import { NextRequest, NextResponse } from "next/server";

import { verifyRequest, UnauthorizedError } from "../../../lib/orbit-auth";
import { clientForStore } from "../../../lib/orbit";

/**
 * Reading and changing the merchant's own catalogue.
 *
 * This is the part people are usually here for: your plugin acting on the
 * store's real data, not just its own. Everything goes through the SDK, using
 * the credential this store granted at install — so a plugin can only ever
 * touch the store that installed it, and only within the scopes consented to.
 *
 * Requires `product:list` to browse and `product:update` to change.
 * Note those are separate scopes: `product:read` alone will not list.
 */
/** The fields this sample uses. A product carries about sixty. */
interface ApiProduct {
  id: string;
  name: string;
  status: string;
  prices?: { price: string }[];
  images?: { url: string }[];
}

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );

    const orbit = await clientForStore(storeId);
    if (!orbit) {
      return NextResponse.json({ error: "Not connected" }, { status: 409 });
    }

    const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
    const result = await orbit.products.list({ page, limit: 10 });

    // `list()` returns `Record<string, unknown>[]` today — the response is not
    // typed, so describe the fields you rely on yourself rather than reaching
    // for the SDK's shared `Product` type, which does not match this endpoint
    // (it declares `price: number` and `isActive`, where the API returns a
    // `prices` array and a `status` string).
    const items = (result.items ?? []) as unknown as ApiProduct[];

    // Send the view only what it needs. Passing the raw product through would
    // ship 60 fields to the browser, and pin your UI to a response shape you
    // do not control.
    const products = items.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      // Money is a decimal STRING so nothing is rounded in transit. Keep it a
      // string all the way to the screen; parse it only where you must.
      price: p.prices?.[0]?.price ?? null,
      image: p.images?.[0]?.url ?? null,
    }));

    return NextResponse.json({ products, meta: result.meta });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Rename one product.
 *
 * Deliberately narrow: a plugin should ask for the smallest change it needs.
 * `orbit.products.update` takes a partial, so send only the field you are
 * changing rather than reading the product and posting it back — a read-modify-
 * write races with the merchant editing the same product in another tab.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );
    const { id, name } = await request.json();

    if (typeof id !== "string" || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "id and a non-empty name are required" },
        { status: 400 },
      );
    }

    const orbit = await clientForStore(storeId);
    if (!orbit) {
      return NextResponse.json({ error: "Not connected" }, { status: 409 });
    }

    // Scoped by the token, not by anything the caller sent: this credential
    // belongs to one store, so it cannot reach another store's product even
    // if someone passes a valid id from elsewhere.
    await orbit.products.update(id, { name: name.trim().slice(0, 200) });

    return NextResponse.json({ updated: true });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Archive a product — the closest thing to a delete that a plugin gets.
 *
 * **The public API has no product delete, on purpose.** A plugin can create
 * and change catalogue entries but cannot destroy them; removing a product is
 * the merchant's decision, made in their own dashboard, where the consequences
 * are visible. Archiving is reversible and honest about what it is.
 *
 * Treat it as destructive anyway: confirm before calling this. The UI does.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { storeId } = await verifyRequest(
      request.headers.get("Authorization"),
    );
    const id = new URL(request.url).searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const orbit = await clientForStore(storeId);
    if (!orbit) {
      return NextResponse.json({ error: "Not connected" }, { status: 409 });
    }

    await orbit.products.update(id, { status: "archived" });

    return NextResponse.json({ archived: true });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  console.error("[starter]", error);
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}
