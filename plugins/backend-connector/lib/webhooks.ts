import type { OrbitApi, WebhookSubscription } from "./orbit-api";

/**
 * Webhook subscriptions.
 *
 * Prefer these to polling. Orbit will POST to a URL you own as things happen,
 * which is both cheaper and more timely than asking every five minutes.
 *
 * Subscriptions are made at runtime, once, after your connection is stored —
 * there is no way to declare them in your manifest as a third party. They
 * belong to the installation, so they disappear when the merchant uninstalls,
 * and you do not have to clean them up yourself.
 *
 * Requires the `webhook:create` scope, plus the read scope for each topic
 * (`order.*` needs `order:read`, `product.*` needs `product:read`, and so on).
 */


/**
 * Subscribe to `topics`, skipping any that are already subscribed.
 *
 * Idempotent on purpose: a worker restarts, and re-subscribing blindly on every
 * boot would accumulate duplicates and deliver each event several times.
 *
 * The URL must be HTTPS — plain http is rejected with a 400.
 */
export async function ensureSubscriptions(
  api: OrbitApi,
  webhookUrl: string,
  topics: string[]
): Promise<{ created: string[]; existing: string[] }> {
  const current = await api.listWebhooks();

  const alreadySubscribed = new Set(
    current
      .filter((s) => s.isActive && s.webhookUrl === webhookUrl)
      .map((s) => s.topic)
  );

  const created: string[] = [];
  const existing: string[] = [];

  for (const topic of topics) {
    if (alreadySubscribed.has(topic)) {
      existing.push(topic);
      continue;
    }
    await api.createWebhook(topic, webhookUrl);
    created.push(topic);
  }

  return { created, existing };
}
