/**
 * Partner login brute-force guard (backend only).
 *
 * Two independent, FAILURE-DRIVEN mechanisms — successful sign-ins never
 * consume budget (rate limiter counts failures only):
 *
 * 1. IP failure rate — sliding 1-minute window; blunts password-spraying
 *    bursts that hop across e-mail addresses.
 * 2. IP+e-mail lockout with exponential backoff — applies identically to
 *    KNOWN and UNKNOWN addresses, so the lock transition cannot be used to
 *    enumerate accounts (same 429 body shape as the account lock in
 *    partner-auth.ts). A real partner is never locked out indefinitely:
 *    locks are time-bounded, backoff decays after 24h, a successful sign-in
 *    clears the bucket, and the account-level lock (15 min, success-reset) is
 *    an independent second layer that the attacker's IP cannot extend.
 *
 * Single-process limitation (documented): both structures are in-memory Maps
 * bounded to 5 000 keys with oldest-entry pruning. Correct for this
 * single-node deployment; a multi-node production deployment MUST move them
 * to a shared store (Redis or a DB-backed counter) or limits are enforced
 * per node only.
 */

const FAILURE_WINDOW_MS = 60_000; // sliding window for the IP failure rate
const IP_FAILURE_MAX = 20; // failed logins per IP per window (successes excluded)
const EMAIL_FAIL_THRESHOLD = 8; // failures before an IP+e-mail bucket locks
const EMAIL_FAIL_WINDOW_MS = 15 * 60_000; // failures older than this are forgotten
const BASE_LOCK_MS = 15 * 60_000; // first lockout — matches the account lock
const MAX_LOCK_MS = 6 * 3_600_000; // exponential backoff ceiling
const VIOLATION_DECAY_MS = 24 * 3_600_000; // backoff resets a day after the last lock
const MAP_MAX = 5_000; // bound both maps — unbounded keys are a memory-DoS vector

interface LoginBucket {
  fails: number[];
  lockedUntil: number;
  violations: number;
  lastLockAt: number;
}

const emailBuckets = new Map<string, LoginBucket>();
const ipFails = new Map<string, number[]>();

/** Prune the oldest ~1000 entries (Map preserves insertion order). */
function prune(map: Map<string, unknown>): void {
  if (map.size <= MAP_MAX) return;
  let n = 1000;
  for (const key of map.keys()) {
    if (n-- <= 0) break;
    map.delete(key);
  }
}

/** Seconds until the IP+e-mail bucket unlocks (0 = not locked). */
export function ipEmailLockRemaining(ip: string, email: string): number {
  const b = emailBuckets.get(`${ip}|${email}`);
  if (!b || b.lockedUntil <= Date.now()) return 0;
  return Math.ceil((b.lockedUntil - Date.now()) / 1000);
}

/** True when this IP has burned its failure budget (failures only). */
export function ipFailureRateExceeded(ip: string): boolean {
  const now = Date.now();
  const hits = (ipFails.get(ip) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  return hits.length >= IP_FAILURE_MAX;
}

/** Record ONE failed credential attempt (401 outcome). */
export function recordLoginFailure(ip: string, email: string): void {
  const now = Date.now();

  const ipHits = (ipFails.get(ip) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  ipHits.push(now);
  ipFails.set(ip, ipHits);
  prune(ipFails);

  const key = `${ip}|${email}`;
  const b = emailBuckets.get(key) ?? { fails: [], lockedUntil: 0, violations: 0, lastLockAt: 0 };
  b.fails = b.fails.filter((t) => now - t < EMAIL_FAIL_WINDOW_MS);
  b.fails.push(now);
  if (b.fails.length >= EMAIL_FAIL_THRESHOLD) {
    if (now - b.lastLockAt > VIOLATION_DECAY_MS) b.violations = 0;
    b.violations += 1;
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** (b.violations - 1), MAX_LOCK_MS);
    b.lockedUntil = now + lockMs;
    b.lastLockAt = now;
    b.fails = [];
  }
  emailBuckets.set(key, b);
  prune(emailBuckets);
}

/** Clear the IP+e-mail bucket after a successful sign-in. */
export function clearLoginFailures(ip: string, email: string): void {
  emailBuckets.delete(`${ip}|${email}`);
}
