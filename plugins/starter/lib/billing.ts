import { clientForStore } from "./orbit";

/**
 * Whether this store is entitled to the paid part of your plugin.
 *
 * ## Check this on the server, not in the page
 *
 * The embed can ask too, and should, so the UI can show the right thing. But
 * the embed runs on the merchant's machine and anything it decides can be
 * edited. If a feature costs you money — an API you pay for, compute, storage —
 * the decision has to be made somewhere the merchant cannot reach. That is
 * here.
 *
 * ## Requires the `billing:read` scope
 *
 * Without it this endpoint answers 401, and a naive implementation catches
 * that and reports "not subscribed" — which looks like a working free tier
 * while silently denying paying customers what they paid for. Ask for the
 * scope, and treat an error as an error rather than as a negative answer.
 */
export type Entitlement =
  | { state: "entitled"; planName?: string }
  | { state: "not_entitled" }
  | { state: "unknown"; reason: string };

export async function checkEntitlement(storeId: string): Promise<Entitlement> {
  const orbit = await clientForStore(storeId);
  if (!orbit) return { state: "unknown", reason: "no connection" };

  try {
    const status = await orbit.billing.getSubscriptionStatus();

    if (!status.hasSubscription || !status.subscription) {
      return { state: "not_entitled" };
    }

    // A trialing subscription is still an entitlement — the merchant agreed to
    // the plan and expects the features. Treating a trial as unpaid is a
    // reliable way to annoy people during the exact window you are trying to
    // convert them.
    const active = ["active", "trialing"].includes(
      String(status.subscription.status).toLowerCase(),
    );

    return active
      ? { state: "entitled", planName: status.subscription.planName }
      : { state: "not_entitled" };
  } catch (error) {
    // Deliberately NOT "not entitled". An outage, a missing scope or a network
    // blip must not silently downgrade a paying customer — decide what your
    // plugin does with `unknown` rather than defaulting it to a denial.
    return {
      state: "unknown",
      reason: error instanceof Error ? error.message : "billing unavailable",
    };
  }
}
