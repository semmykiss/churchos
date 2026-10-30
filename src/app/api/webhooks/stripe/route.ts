import { constructWebhookEvent } from "@/server/services/stripe-provider";
import { handleStripeEvent } from "@/server/services/giving";

/**
 * Stripe webhook receiver — POST /api/webhooks/stripe
 *
 * DELIBERATELY OUTSIDE /api/v1: Stripe calls this without a church session.
 * The request body must stay RAW (byte-exact) for signature verification —
 * the /api/v1 router parses JSON, which would destroy the signature.
 *
 * Security: the event is only trusted after `constructEventAsync` verifies
 * the `stripe-signature` header against STRIPE_WEBHOOK_SECRET. Unsigned or
 * forged requests get 400 and never touch the ledger.
 *
 * Settlement is idempotent: payment_intent.succeeded funnels into
 * settleOnlinePayment, which is a no-op if the payment already settled
 * (e.g. synchronously for off-session cards).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "unreadable_body" }, { status: 400 });
  }
  try {
    const event = await constructWebhookEvent(raw, signature);
    const result = await handleStripeEvent(event as unknown as Parameters<typeof handleStripeEvent>[0]);
    return Response.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    // Signature/configuration failures are client errors (400); keep the
    // response generic so nothing about the internals leaks.
    return Response.json({ error: "invalid_webhook", message }, { status: 400 });
  }
}
