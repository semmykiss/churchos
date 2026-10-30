"use client";

/**
 * Client-side Stripe loader (browser only).
 *  • NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set → real Stripe.js (Elements, 3DS,
 *    ACH mandates). The publishable key and the backend STRIPE_SECRET_KEY are
 *    provisioned together; the backend is the source of truth per-request
 *    (responses carry mode/clientSecret), this only lazy-loads the SDK.
 *  • Key absent → demo processor mode: the token stand-in forms are used and
 *    the give flow settles synchronously server-side.
 */
import { loadStripe, type Stripe } from "@stripe/stripe-js";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

let stripePromise: Promise<Stripe | null> | null = null;

export function stripePublishable(): string {
  return PUBLISHABLE_KEY;
}

export function stripeClientEnabled(): boolean {
  return Boolean(PUBLISHABLE_KEY);
}

export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : Promise.resolve(null);
  }
  return stripePromise;
}
