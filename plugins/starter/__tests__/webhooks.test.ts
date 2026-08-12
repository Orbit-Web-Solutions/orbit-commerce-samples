import { describe, it, expect, vi } from "vitest";

import { ensureSubscriptions } from "../lib/webhooks";
import * as rest from "../lib/orbit-rest";

const URL = "https://example.com/api/webhooks/orbit";
const TOKEN = "access-token";

function stub(existing: Partial<rest.WebhookSubscription>[]) {
  vi.spyOn(rest, "listWebhooks").mockResolvedValue(
    existing.map((e, i) => ({
      id: e.id ?? `sub-${i}`,
      topic: e.topic ?? "order.created",
      webhookUrl: e.webhookUrl ?? URL,
      isActive: e.isActive ?? true,
    })),
  );
  const del = vi.spyOn(rest, "deleteWebhook").mockResolvedValue({});
  const create = vi
    .spyOn(rest, "createWebhook")
    .mockResolvedValue({} as rest.WebhookSubscription);
  return { create, del };
}

describe("ensureSubscriptions", () => {
  it("subscribes to topics that are missing", async () => {
    const { create } = stub([]);

    const result = await ensureSubscriptions(TOKEN, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.created).toEqual(["order.created", "order.updated"]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  /**
   * The reason this helper exists. It runs on every connect; subscribing
   * blindly would accumulate duplicates and deliver each event repeatedly.
   */
  it("does not re-subscribe to a topic it already has", async () => {
    const { create } = stub([{ topic: "order.created" }]);

    const result = await ensureSubscriptions(TOKEN, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.unchanged).toEqual(["order.created"]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(TOKEN, "order.updated", URL);
  });

  /**
   * The bug this replaced. Uniqueness is (subscriber, topic) — the URL is not
   * part of it — so a topic pointing at a stale address cannot just be created
   * again. The previous version treated it as missing, tried to create, and
   * got a 409 it did not handle. It has to be deleted first.
   */
  it("replaces a subscription pointing at a stale URL", async () => {
    const { create, del } = stub([
      {
        id: "sub-old",
        topic: "order.created",
        webhookUrl: "https://old-host/hook",
      },
    ]);

    const result = await ensureSubscriptions(TOKEN, URL, ["order.created"]);

    expect(result.replaced).toEqual(["order.created"]);
    expect(result.created).toEqual([]);
    expect(del).toHaveBeenCalledWith(TOKEN, "sub-old");
    expect(create).toHaveBeenCalledWith(TOKEN, "order.created", URL);
  });

  it("replaces a subscription that has been deactivated", async () => {
    const { create, del } = stub([
      { id: "sub-off", topic: "order.created", isActive: false },
    ]);

    const result = await ensureSubscriptions(TOKEN, URL, ["order.created"]);

    expect(result.replaced).toEqual(["order.created"]);
    expect(del).toHaveBeenCalledWith(TOKEN, "sub-off");
    expect(create).toHaveBeenCalled();
  });

  it("does not delete anything when everything is already correct", async () => {
    const { create, del } = stub([
      { topic: "order.created" },
      { topic: "order.updated" },
    ]);

    const result = await ensureSubscriptions(TOKEN, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.unchanged).toEqual(["order.created", "order.updated"]);
    expect(del).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
