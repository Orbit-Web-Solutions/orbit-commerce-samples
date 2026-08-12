import { listWebhooks, createWebhook, deleteWebhook } from "./orbit-rest";

/**
 * Subscribing to events.
 *
 * Prefer webhooks to polling: Orbit POSTs to a URL you own as things happen,
 * which is cheaper and more timely than asking every few minutes. Poll only
 * when your service cannot accept inbound HTTPS.
 *
 * Subscriptions are made at runtime, after your connection is stored — a
 * third-party plugin cannot declare them in its manifest. They belong to the
 * installation, so they disappear when the merchant uninstalls and you do not
 * have to clean them up.
 *
 * Direct REST because the SDK has no webhooks service yet.
 *
 * ## One subscription per topic
 *
 * The API's uniqueness is **(subscriber, topic)** — your URL is not part of
 * it. So you cannot have one topic going to two endpoints, and a topic already
 * subscribed to a *different* URL cannot simply be created again: that is a
 * 409.
 *
 * This matters more than it sounds. Your URL differs between environments and
 * changes when you redeploy somewhere new, so "already subscribed" is not the
 * same question as "subscribed to the right place". A stale one has to be
 * replaced, or you keep receiving nothing at an address you no longer serve
 * while every reconnect fails with a conflict instead of fixing it.
 */

export interface SubscriptionResult {
  created: string[];
  /** Already pointing at the right URL — left alone. */
  unchanged: string[];
  /** Pointed somewhere stale, so replaced. */
  replaced: string[];
}

export async function ensureSubscriptions(
  accessToken: string,
  webhookUrl: string,
  topics: string[],
): Promise<SubscriptionResult> {
  const current = await listWebhooks(accessToken);
  const byTopic = new Map(current.map((s) => [s.topic, s]));

  const result: SubscriptionResult = {
    created: [],
    unchanged: [],
    replaced: [],
  };

  for (const topic of topics) {
    const existing = byTopic.get(topic);

    // Safe to run on every connect: reconciling rather than creating means no
    // duplicates and no conflict on the second call.
    if (existing?.isActive && existing.webhookUrl === webhookUrl) {
      result.unchanged.push(topic);
      continue;
    }

    if (existing) {
      // Only one subscription per topic is allowed, so the stale one has to go
      // before the correct one can be created.
      await deleteWebhook(accessToken, existing.id);
    }

    await createWebhook(accessToken, topic, webhookUrl);
    (existing ? result.replaced : result.created).push(topic);
  }

  return result;
}
