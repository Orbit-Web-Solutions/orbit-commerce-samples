import { describe, it, expect, vi } from "vitest";

import { ensureSubscriptions } from "../lib/webhooks";
import * as rest from "../lib/orbit-rest";

const URL = "https://example.com/api/webhooks/orbit";
const TOKEN = "access-token";

function stub(existing: Partial<rest.WebhookSubscription>[]) {
  vi.spyOn(rest, "listWebhooks").mockResolvedValue(
    existing.map((e, i) => ({
      id: `sub-${i}`,
      topic: e.topic ?? "order.created",
      webhookUrl: e.webhookUrl ?? URL,
      isActive: e.isActive ?? true,
    })),
  );
  return vi
    .spyOn(rest, "createWebhook")
    .mockResolvedValue({} as rest.WebhookSubscription);
}

describe("ensureSubscriptions", () => {
  it("subscribes to topics that are missing", async () => {
    const create = stub([]);

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
    const create = stub([{ topic: "order.created" }]);

    const result = await ensureSubscriptions(TOKEN, URL, [
      "order.created",
      "order.updated",
    ]);

    expect(result.existing).toEqual(["order.created"]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(TOKEN, "order.updated", URL);
  });

  it("ignores a subscription pointing somewhere else", async () => {
    // Your endpoint moved. The old subscription is listed but is not yours.
    const create = stub([
      { topic: "order.created", webhookUrl: "https://old-host/hook" },
    ]);

    const result = await ensureSubscriptions(TOKEN, URL, ["order.created"]);

    expect(result.created).toEqual(["order.created"]);
    expect(create).toHaveBeenCalled();
  });

  it("ignores an inactive subscription", async () => {
    const create = stub([{ topic: "order.created", isActive: false }]);

    await ensureSubscriptions(TOKEN, URL, ["order.created"]);

    expect(create).toHaveBeenCalled();
  });
});
