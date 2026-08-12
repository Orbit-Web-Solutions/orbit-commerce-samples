import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

import { verifyWebhookSignature } from "../lib/orbit-auth";

const SECRET = "test-webhook-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const BODY = JSON.stringify({
  id: "evt_1",
  topic: "order.created",
  created_at: "2026-08-12T00:00:00Z",
  store_id: "store-1",
  data: { orderId: "ord_1" },
});

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed body and returns the envelope", () => {
    const result = verifyWebhookSignature(BODY, sign(BODY), SECRET);

    expect(result.valid).toBe(true);
    expect(result.envelope?.topic).toBe("order.created");
    expect(result.envelope?.store_id).toBe("store-1");
  });

  /**
   * The whole point. Your webhook URL is public; without this check anyone who
   * finds it can feed your plugin whatever they like.
   */
  it("rejects a body signed with the wrong secret", () => {
    const result = verifyWebhookSignature(
      BODY,
      sign(BODY, "attacker-secret"),
      SECRET,
    );

    expect(result.valid).toBe(false);
    expect(result.envelope).toBeNull();
  });

  it("rejects a body that was altered after signing", () => {
    const signature = sign(BODY);
    const tampered = BODY.replace("ord_1", "ord_999");

    expect(verifyWebhookSignature(tampered, signature, SECRET).valid).toBe(
      false,
    );
  });

  it("rejects a missing signature header", () => {
    const result = verifyWebhookSignature(BODY, null, SECRET);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it("refuses to verify when no secret is configured", () => {
    // Failing closed matters: treating an unset secret as "skip the check"
    // would silently disable verification in any environment that forgot it.
    const result = verifyWebhookSignature(BODY, sign(BODY), "");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/secret/i);
  });

  it("rejects a signed body that is not JSON", () => {
    const body = "not json";

    expect(verifyWebhookSignature(body, sign(body), SECRET).valid).toBe(false);
  });
});
