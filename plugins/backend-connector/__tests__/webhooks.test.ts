import { describe, it, expect, vi } from "vitest";

import { ensureSubscriptions } from "../lib/webhooks";
import type { OrbitApi, WebhookSubscription } from "../lib/orbit-api";

const URL = "https://example.com/webhooks/orbit";

function apiWith(existing: Partial<WebhookSubscription>[]) {
  const createWebhook = vi.fn().mockResolvedValue({});
  const listWebhooks = vi.fn().mockResolvedValue(
    existing.map((e, i) => ({
      id: `sub-${i}`,
      topic: e.topic ?? "order.created",
      webhookUrl: e.webhookUrl ?? URL,
      isActive: e.isActive ?? true,
    })),
  );
  return { api: { listWebhooks, createWebhook } as unknown as OrbitApi, createWebhook };
}

describe("ensureSubscriptions", () => {
  it("subscribes to topics that are missing", async () => {
    const { api, createWebhook } = apiWith([]);

    const result = await ensureSubscriptions(api, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.created).toEqual(["order.created", "order.updated"]);
    expect(createWebhook).toHaveBeenCalledTimes(2);
  });

  /**
   * The reason this helper exists. A worker restarts; subscribing blindly on
   * every boot would accumulate duplicates and deliver each event repeatedly.
   */
  it("does not re-subscribe to a topic it already has", async () => {
    const { api, createWebhook } = apiWith([{ topic: "order.created" }]);

    const result = await ensureSubscriptions(api, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.existing).toEqual(["order.created"]);
    expect(result.created).toEqual(["order.updated"]);
    expect(createWebhook).toHaveBeenCalledTimes(1);
    expect(createWebhook).toHaveBeenCalledWith("order.updated", URL);
  });

  it("is a no-op when everything is already subscribed", async () => {
    const { api, createWebhook } = apiWith([
      { topic: "order.created" },
      { topic: "order.updated" },
    ]);

    const result = await ensureSubscriptions(api, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.created).toEqual([]);
    expect(createWebhook).not.toHaveBeenCalled();
  });

  it("ignores a subscription pointing at a different URL", async () => {
    // Your endpoint moved. The old subscription is still listed, but it is not
    // yours any more — you need a new one, not a skip.
    const { api, createWebhook } = apiWith([
      { topic: "order.created", webhookUrl: "https://old-host/webhooks" },
    ]);

    const result = await ensureSubscriptions(api, URL, ["order.created"]);

    expect(result.created).toEqual(["order.created"]);
    expect(createWebhook).toHaveBeenCalledWith("order.created", URL);
  });

  it("ignores an inactive subscription", async () => {
    const { api, createWebhook } = apiWith([
      { topic: "order.created", isActive: false },
    ]);

    const result = await ensureSubscriptions(api, URL, ["order.created"]);

    expect(result.created).toEqual(["order.created"]);
    expect(createWebhook).toHaveBeenCalled();
  });
});
