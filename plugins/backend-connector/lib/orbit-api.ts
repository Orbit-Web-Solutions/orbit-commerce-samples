/**
 * A minimal Orbit public-API client written with plain `fetch`.
 *
 * `@orbitcommerce/sdk` does all of this for you and is the right choice in a
 * Node integration. This sample spells the HTTP out instead, because the
 * protocol is the part worth understanding — and because plenty of connectors
 * are written in languages the SDK does not cover. Every call below is
 * reproducible in any HTTP client.
 */

const API_URL = process.env.ORBIT_API_URL ?? "https://api.myorbitcommerce.net";

/**
 * Every REST response on the platform arrives wrapped:
 *   { statusCode, message, data, timestamp }
 * Read the top-level body instead of `data` and every field is undefined — a
 * mistake common enough to be worth naming here.
 */
interface Envelope<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

export class OrbitApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "OrbitApiError";
  }

  /**
   * A 401 on a data call means the access token expired or was revoked —
   * refresh and retry once. A 401 from the refresh endpoint itself is
   * terminal; see `OrbitConnection.accessToken`.
   */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** The per-install ceiling was hit. Back off; do not hammer. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/**
 * The fields this sample uses. An order carries a great deal more — read one
 * from your own store rather than treating this as the schema.
 *
 * Money arrives as a decimal STRING, not a number, so that no value is ever
 * rounded in transit. Parse it with something exact; `Number()` is used below
 * only because the stub ERP takes a number.
 *
 * Note there is no `externalId` here. It exists on order CREATE, where it
 * deduplicates orders you push into Orbit, but it is not returned on read —
 * so when syncing the other way, key your records on the Orbit order `id`.
 */
export interface OrbitOrder {
  id: string;
  orderNumber: string;
  status: string;
  total: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Batch sizes the API enforces. Exceeding them is a 400, not a silent
 * truncation, so size your batches from these rather than discovering them.
 */
export const MAX_BULK_UPDATE_ITEMS = 50;
export const MAX_LOOKUP_VALUES = 200;

export interface WebhookSubscription {
  id: string;
  topic: string;
  webhookUrl: string;
  isActive: boolean;
}

export class OrbitApi {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new OrbitApiError(
        response.status,
        text,
        `${init.method ?? "GET"} ${path} failed with ${response.status}`,
      );
    }

    return (JSON.parse(text) as Envelope<T>).data;
  }

  /**
   * Orders touched since a timestamp. Requires the `order:list` scope.
   *
   * `updatedFrom` rather than a created-at filter, deliberately: an
   * incremental sync wants orders whose *state* changed — a cancellation or a
   * payment on a week-old order matters to your ERP as much as a new order
   * does. Use `dateFrom`/`dateTo` when you want the creation window instead.
   *
   * Note the API rejects unknown query parameters outright rather than
   * ignoring them, so a guessed filter name surfaces as a 400.
   *
   * Polling like this is fine, but webhooks are usually better: subscribe to
   * `order.created` / `order.updated` and Orbit pushes you the change as it
   * happens. Polling stays the right answer when your service cannot accept
   * inbound HTTPS, which is common inside a corporate network.
   */
  listOrdersUpdatedSince(
    since: Date,
    limit = 50,
  ): Promise<Paginated<OrbitOrder>> {
    const params = new URLSearchParams({
      updatedFrom: since.toISOString(),
      limit: String(limit),
    });
    return this.request<Paginated<OrbitOrder>>(`/v1/orders?${params}`);
  }

  /**
   * Map your own identifiers onto Orbit product ids — the join an ERP sync
   * needs, since your system knows SKUs and Orbit knows uuids. Returns a
   * `{ matchValue: productId }` map. Requires `product:read`.
   *
   * Match on `sku`, `handle` or `barcode`; up to 200 values per call.
   */
  lookupProductIds(
    field: "sku" | "handle" | "barcode",
    values: string[],
  ): Promise<Record<string, string>> {
    if (values.length > MAX_LOOKUP_VALUES) {
      throw new RangeError(
        `batch-lookup accepts at most ${MAX_LOOKUP_VALUES} values, got ${values.length}`,
      );
    }
    return this.request<Record<string, string>>("/v1/products/batch-lookup", {
      method: "POST",
      body: JSON.stringify({ field, values }),
    });
  }

  /**
   * Push changes back, up to 50 products per call. Requires `product:update`.
   * Returns `{ results: [{ id, success, error? }] }`, so a partial failure is
   * visible rather than silent — check it instead of assuming success.
   *
   * **Unrecognised fields are stripped, not rejected.** Send `stockQuantity`
   * instead of `quantity` and the response is still `success: true` while
   * nothing changes. Note this is the opposite of the query-string behaviour,
   * where an unknown parameter is a 400 — do not assume one from the other.
   * Confirm the first write of any new field actually landed.
   *
   * The accepted scalar fields are: brandId, name, handle, description,
   * shortDescription, sku, barcode, quantity, isPhysical, isTaxable, weight,
   * weightUnit, shippingClassId, dimensions*, status, seoTitle,
   * seoDescription, hasVariants, trackInventory, allowBackorder, locationId.
   */
  bulkUpdateProducts(products: Record<string, unknown>[]): Promise<unknown> {
    if (products.length > MAX_BULK_UPDATE_ITEMS) {
      throw new RangeError(
        `bulk-update accepts at most ${MAX_BULK_UPDATE_ITEMS} products, got ${products.length}`,
      );
    }
    return this.request("/v1/products/bulk-update", {
      method: "PATCH",
      body: JSON.stringify({ products }),
    });
  }

  /**
   * Subscriptions belonging to this installation. Requires `webhook:list`.
   */
  listWebhooks(): Promise<WebhookSubscription[]> {
    return this.request<WebhookSubscription[]>("/v1/webhooks");
  }

  /**
   * Ask Orbit to POST to `webhookUrl` when `topic` happens. Requires
   * `webhook:create` plus the read scope for the topic.
   *
   * The URL must be HTTPS; plain http is rejected with a 400.
   */
  createWebhook(
    topic: string,
    webhookUrl: string,
  ): Promise<WebhookSubscription> {
    return this.request<WebhookSubscription>("/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({ topic, webhookUrl }),
    });
  }

  /** Requires `webhook:delete`. */
  deleteWebhook(id: string): Promise<unknown> {
    return this.request(`/v1/webhooks/${id}`, { method: "DELETE" });
  }
}

/**
 * Rate limits, so you can size a sync rather than discover them in production:
 * 600 reads and 300 writes per minute per installed app, plus a platform-wide
 * 600 requests per minute per IP address. A loop that pages as fast as it can
 * will reach these, so pause between batches.
 */
export const RATE_LIMITS = {
  readsPerMinute: 600,
  writesPerMinute: 300,
} as const;
