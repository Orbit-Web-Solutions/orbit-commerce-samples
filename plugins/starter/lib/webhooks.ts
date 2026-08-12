import { listWebhooks, createWebhook } from "./orbit-rest";

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
 */
export async function ensureSubscriptions(
  accessToken: string,
  webhookUrl: string,
  topics: string[],
): Promise<{ created: string[]; existing: string[] }> {
  const current = await listWebhooks(accessToken);

  const alreadySubscribed = new Set(
    current
      .filter((s) => s.isActive && s.webhookUrl === webhookUrl)
      .map((s) => s.topic),
  );

  const created: string[] = [];
  const existing: string[] = [];

  for (const topic of topics) {
    // Idempotent on purpose: this runs on every connect, and re-subscribing
    // blindly would accumulate duplicates and deliver each event several times.
    if (alreadySubscribed.has(topic)) {
      existing.push(topic);
      continue;
    }
    await createWebhook(accessToken, topic, webhookUrl);
    created.push(topic);
  }

  return { created, existing };
}
