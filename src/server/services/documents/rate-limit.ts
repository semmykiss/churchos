/**
 * Fixed-window in-memory rate limiter (backend only) for the abuse-sensitive
 * DMS endpoints (public share redemption, file downloads, uploads).
 * Single-node memory store — swap for Redis/Upstash when the app scales out;
 * the call sites only depend on checkRate() throwing a 429 ApiError.
 */
import { ApiError } from "@/server/http";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// occasional sweep so the map does not grow forever
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}

/**
 * Throw a 429 when `key` exceeds `limit` requests per `windowMs`.
 * @param key    stable identity, e.g. "share-redeem:{ip}"
 * @param limit  max requests per window
 * @param windowMs window length (default 60s)
 */
export function checkRate(key: string, limit: number, windowMs = 60_000): void {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count++;
  if (bucket.count > limit) {
    const secs = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${secs}s.`);
  }
}
