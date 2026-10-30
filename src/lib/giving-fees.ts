/**
 * Client-safe giving fee math — shared by the member portal (display) and the
 * server service (authoritative calculation). Changing the schedule here
 * updates both; the server value always wins at settlement time.
 */
export const PROVIDER_FEE_PCT = 0.022; // 2.2%
export const PROVIDER_FEE_FIXED = 30; // + 30¢

export function processorFeeCents(amountCents: number): number {
  return Math.round(amountCents * PROVIDER_FEE_PCT) + PROVIDER_FEE_FIXED;
}
