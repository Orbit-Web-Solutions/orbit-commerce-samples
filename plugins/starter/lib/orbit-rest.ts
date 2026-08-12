/**
 * The two calls `@orbitcommerce/sdk` does not cover yet.
 *
 * Use the SDK for everything it does — it is typed, it auto-chunks bulk
 * updates, and it handles token rotation. `lib/orbit.ts` builds the client.
 *
 * These two are here because the SDK has no equivalent today:
 *
 *   - **Listing orders.** `OrdersService` exposes only `create()`, so an
 *     incremental order pull — the primary read for most back-office
 *     integrations — has to be made directly.
 *   - **Webhook subscriptions.** There is no webhooks service in the SDK at
 *     all.
 *
 * If those land in a later SDK release, delete this file and use them.
 */

const API_URL = process.env.ORBIT_API_URL ?? "https://api.myorbitcommerce.net";

/**
 * Every REST response on the platform arrives wrapped:
 *   { statusCode, message, data, timestamp }
 * Read the top-level body instead of `data` and every field is undefined. The
 * SDK unwraps this for you; here we do it by hand.
 */
interface Envelope<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

export class OrbitRestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "OrbitRestError";
  }

  /** The per-install ceiling was hit. Back off; do not hammer. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** The fields this sample uses. An order carries a great deal more. */
export interface OrbitOrder {
  id: string;
  orderNumber: string;
  status: string;
  /** A decimal STRING, so no value is rounded in transit. Parse exactly. */
  total: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface WebhookSubscription {
  id: string;
  topic: string;
  webhookUrl: string;
  isActive: boolean;
}

async function request<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new OrbitRestError(
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
 * `updatedFrom` rather than a created-at filter, deliberately: an incremental
 * sync wants orders whose *state* changed — a cancellation or a payment on a
 * week-old order matters as much as a new order does. Use `dateFrom`/`dateTo`
 * when you want the creation window instead.
 *
 * The API rejects unknown query parameters rather than ignoring them, so a
 * guessed filter name surfaces as a 400 rather than silently returning
 * everything.
 */
export function listOrdersUpdatedSince(
  accessToken: string,
  since: Date,
  limit = 50,
): Promise<Paginated<OrbitOrder>> {
  const params = new URLSearchParams({
    updatedFrom: since.toISOString(),
    limit: String(limit),
  });
  return request<Paginated<OrbitOrder>>(accessToken, `/v1/orders?${params}`);
}

/** Subscriptions belonging to this installation. Requires `webhook:list`. */
export function listWebhooks(
  accessToken: string,
): Promise<WebhookSubscription[]> {
  return request<WebhookSubscription[]>(accessToken, "/v1/webhooks");
}

/**
 * Ask Orbit to POST to `webhookUrl` when `topic` happens. Requires
 * `webhook:create` plus the read scope for the topic (`order.*` needs
 * `order:read`).
 *
 * The URL must be HTTPS; plain http is rejected with a 400.
 */
export function createWebhook(
  accessToken: string,
  topic: string,
  webhookUrl: string,
): Promise<WebhookSubscription> {
  return request<WebhookSubscription>(accessToken, "/v1/webhooks", {
    method: "POST",
    body: JSON.stringify({ topic, webhookUrl }),
  });
}

/**
 * Remove a subscription. Requires `webhook:delete`.
 *
 * Needed because only one subscription per topic is allowed — replacing a
 * stale URL means deleting first. See `webhooks.ts`.
 */
export function deleteWebhook(
  accessToken: string,
  id: string,
): Promise<unknown> {
  return request(accessToken, `/v1/webhooks/${id}`, { method: "DELETE" });
}
