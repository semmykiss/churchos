/**
 * Stripe provider — the REAL payment processor behind the giving seam.
 *
 * Activation: enabled only when STRIPE_SECRET_KEY is set. Without keys the
 * giving service transparently falls back to the built-in demo processor
 * (same intent lifecycle, synchronous settlement) so local/Windows installs
 * keep working offline.
 *
 * PCI posture (unchanged): raw card/bank numbers NEVER reach this module.
 * It handles only processor tokens — cus_…, pm_…, seti_…, pi_… — minted
 * client-side by Stripe.js/Elements.
 */
import type Stripe from "stripe";

let cached: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Lazy Stripe client — the SDK is only imported when keys exist. */
export async function getStripe(): Promise<Stripe> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured — demo processor is active.");
  if (!cached) {
    const { default: StripeCtor } = await import("stripe");
    cached = new StripeCtor(key, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });
  }
  return cached;
}

/** Get-or-create the Stripe Customer for a person (cached on the payment method row). */
export async function ensureCustomer(
  stripe: Stripe,
  existingCustomerId: string | null,
  person: { id: string; name?: string | null; email?: string | null },
): Promise<string> {
  if (existingCustomerId) {
    try {
      const c = await stripe.customers.retrieve(existingCustomerId);
      if (!c.deleted) return existingCustomerId;
    } catch {
      // stale id — fall through and mint a fresh customer
    }
  }
  const customer = await stripe.customers.create({
    name: person.name ?? undefined,
    email: person.email ?? undefined,
    metadata: { personId: person.id },
  });
  return customer.id;
}

export interface GiftIntentResult {
  status: "succeeded" | "requires_action" | "failed";
  intentId: string;
  clientSecret?: string;
  failureReason?: string;
}

/**
 * Create + confirm a PaymentIntent against a SAVED payment method.
 *  • card  → off-session confirm (works for most cards; SCA cards return
 *            requires_action + clientSecret for the member to finish in-browser)
 *  • ach   → intent created WITHOUT confirm; the member completes mandate
 *            authorization in-browser via Stripe.js (confirmUsBankAccountPayment)
 */
export async function createGiftIntent(input: {
  amountCents: number; // charge total (gift + donor-covered fee)
  currency?: string;
  customerId: string;
  paymentMethodId: string; // Stripe pm_…
  type: string; // card | ach
  idempotencyKey: string;
  memo?: string;
  personId: string;
  fundSummary?: string;
}): Promise<GiftIntentResult> {
  const stripe = await getStripe();
  const common = {
    amount: input.amountCents,
    currency: (input.currency ?? "ngn").toLowerCase(),
    customer: input.customerId,
    payment_method: input.paymentMethodId,
    metadata: {
      personId: input.personId,
      fundSummary: input.fundSummary ?? "",
      memo: input.memo ?? "",
    },
  };
  const intent = await stripe.paymentIntents.create(
    input.type === "ach"
      ? {
          ...common,
          payment_method_types: ["us_bank_account"],
          confirm: false, // member authorizes the mandate in-browser
        }
      : {
          ...common,
          payment_method_types: ["card"],
          confirm: true,
          off_session: true, // saved card charged without the member present
        },
    { idempotencyKey: `gift:${input.idempotencyKey}` },
  );
  if (intent.status === "succeeded") {
    return { status: "succeeded", intentId: intent.id };
  }
  if (intent.status === "requires_payment_method" || intent.status === "canceled") {
    return { status: "failed", intentId: intent.id, failureReason: intent.last_payment_error?.message ?? "Payment declined." };
  }
  // requires_action / requires_confirmation / processing → member completes in-browser
  return { status: "requires_action", intentId: intent.id, clientSecret: intent.client_secret ?? undefined };
}

/** SetupIntent for saving a NEW card/bank without charging. */
export async function createSetupIntent(customerId: string): Promise<{ clientSecret: string }> {
  const stripe = await getStripe();
  const setup = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card", "us_bank_account"],
    usage: "off_session",
  });
  return { clientSecret: setup.client_secret ?? "" };
}

/** Attach a SetupIntent-confirmed token and read back SAFE display metadata. */
export async function attachAndDescribeMethod(stripe: Stripe, pmId: string, customerId: string): Promise<{
  type: "card" | "ach";
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}> {
  const pm = await stripe.paymentMethods.attach(pmId, { customer: customerId });
  if (pm.type === "card") {
    return {
      type: "card",
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
    };
  }
  if (pm.type === "us_bank_account") {
    return { type: "ach", brand: pm.us_bank_account?.bank_name ?? "bank", last4: pm.us_bank_account?.last4 ?? null, expMonth: null, expYear: null };
  }
  throw new Error(`Unsupported Stripe payment method type: ${pm.type}`);
}

/**
 * Verify + parse a webhook event. Signature check happens HERE (raw body +
 * STRIPE_WEBHOOK_SECRET) — an unsigned or forged request never touches the
 * ledger. Uses constructEventAsync (edge/worker-safe).
 */
export async function constructWebhookEvent(rawBody: string, signature: string | null): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  if (!signature) throw new Error("Missing stripe-signature header.");
  const stripe = await getStripe();
  return stripe.webhooks.constructEventAsync(rawBody, signature, secret);
}
