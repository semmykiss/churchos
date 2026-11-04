import { db } from "@/server/db";
import { ApiError } from "@/server/http";
import { encryptField, decryptField } from "@/server/services/tenant/crypto";

/**
 * Idempotency replay store for partner mutations (backend only).
 *
 * Partner clients send an `Idempotency-Key` header on double-submit-prone
 * mutations (tenant onboarding). The first execution stores the serialized
 * response; a retry with the same key inside the window replays the stored
 * response instead of re-executing — so a dropped network connection can
 * never create two churches.
 *
 * Hardening (partner console security upgrade):
 * • Records are scoped PER PARTNER — `${endpoint}:${partnerUserId}:${key}` —
 *   so one partner's key can never replay (or collide with) another's.
 * • The stored response is ENCRYPTED at rest (AES-256-GCM via tenant/crypto):
 *   it contains a live invite link + the full license key, which must not sit
 *   readable in the DB for 24h. Replay decrypts and re-serializes the exact
 *   same JSON, so the replayed response stays byte-identical to the original.
 * • CLAIM-FIRST arbitration: the first duplicate CREATES a placeholder row;
 *   concurrent losers get 409 idempotency_in_progress instead of
 *   double-executing the mutation. A failed execution releases the claim so
 *   the client can retry cleanly with the same key.
 */

const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;
/** Claim window for the un-populated placeholder — extends to the full TTL
 *  once the real response is stored, so a crashed handler self-releases. */
const CLAIM_TTL_MS = 2 * 60 * 1000;
const CLEANUP_PROBABILITY = 0.05; // ~1 in 20 calls
const PLACEHOLDER = "{}";
/** "{}" is never empty → encryptField always yields a real ciphertext here. */
const PLACEHOLDER_CIPHER = encryptField(PLACEHOLDER) as string;

function claimTtl(): Date {
  return new Date(Date.now() + CLAIM_TTL_MS);
}

function plusTtl(): Date {
  return new Date(Date.now() + IDEMPOTENCY_TTL_MS);
}

export async function withIdempotency<T>(
  key: string,
  endpoint: string,
  partnerUserId: string,
  fn: () => Promise<T>,
  _reclaimed = false,
): Promise<{ replayed: boolean; result: T }> {
  // Per-partner scoping — the raw client key is only unique WITHIN one partner.
  const recordKey = `${endpoint}:${partnerUserId}:${key}`;
  const now = new Date();

  // ── claim-first: the unique key arbitrates racing duplicates ──────────────
  try {
    await db.idempotencyRecord.create({
      data: {
        key: recordKey,
        endpoint,
        status: 200,
        responseJson: PLACEHOLDER_CIPHER,
        expiresAt: claimTtl(),
      },
    });
  } catch {
    // Claim lost (unique violation or transient write error) — inspect the holder.
    const existing = await db.idempotencyRecord.findUnique({ where: { key: recordKey } }).catch(() => null);
    if (existing && existing.expiresAt > now) {
      const stored = decryptField(existing.responseJson);
      if (stored && stored !== PLACEHOLDER) {
        try {
          return { replayed: true, result: JSON.parse(stored) as T };
        } catch {
          // Decryptable but not JSON — fall through to the 409 below
          // (never double-execute against a record we cannot read).
        }
      } else if (stored === null) {
        // DECRYPT FAILURE on an unexpired populated record — corrupt payload
        // or a rotated encryption key. Treat the record as ABSENT (re-execute
        // per the corruption policy): release the stale claim and retry once,
        // so a poisoned key can never wedge a partner.
        if (!_reclaimed) {
          await db.idempotencyRecord.deleteMany({ where: { key: recordKey } }).catch(() => {});
          return withIdempotency(key, endpoint, partnerUserId, fn, true);
        }
      }
    }
    // Placeholder still in progress, or expired record — deterministic 409.
    // Opportunistic GC so expired records (this one included) release soon —
    // never blocks, never fails the request.
    void db.idempotencyRecord
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => {});
    throw new ApiError(409, "idempotency_in_progress", "A request with this key is still in progress.");
  }

  // ── we hold the claim — execute ───────────────────────────────────────────
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    // Best-effort: release the claim so the client can retry cleanly with the
    // same key (a failed execution must not poison the key for 24h).
    await db.idempotencyRecord.deleteMany({ where: { key: recordKey } }).catch(() => {});
    throw err;
  }

  // Opportunistic garbage collection of expired records — never blocks,
  // never fails the request.
  if (Math.random() < CLEANUP_PROBABILITY) {
    void db.idempotencyRecord
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => {});
  }

  try {
    await db.idempotencyRecord.update({
      where: { key: recordKey },
      data: {
        status: 200,
        responseJson: encryptField(JSON.stringify(result)) as string,
        expiresAt: plusTtl(), // extend the claim window to the full 24h TTL
      },
    });
  } catch {
    // Non-JSON-serializable result, or the record expired mid-flight —
    // storage is best-effort and must never break the live response.
  }

  return { replayed: false, result };
}
