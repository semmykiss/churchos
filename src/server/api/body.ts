/**
 * Request-body validators (backend only) — the typed boundary for untrusted
 * client JSON (A7 / B4).
 *
 * The ApiContext hands handlers `Record<string, unknown>` — every value read
 * from `ctx.body` MUST pass through one of these narrowers before it reaches
 * domain code. The `opt*` family is behavior-preserving for legacy handlers:
 * a missing or wrong-typed value yields `undefined`, exactly like destructuring
 * an absent property did. The `req*` family throws a 400 ApiError for NEW
 * endpoints and migrations that want fail-fast boundary validation.
 *
 * Strict narrowing, no string coercion: the only clients of this API are our
 * own frontend bundles, which send proper JSON types. Silently coercing
 * `"12" → 12` would mask client bugs (B4: strict types, reject anomalies).
 */
import { ApiError } from "@/server/http";

/** A plain JSON object (no arrays, no null). */
export type JsonRecord = Record<string, unknown>;

function isObj(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** string value from the body, or undefined. Caps length (default 10 000) to bound storage/log abuse. */
export function optStr(v: unknown, maxLen = 10_000): string | undefined {
  return typeof v === "string" && v.length <= maxLen ? v : undefined;
}

/** string value from `body[key]`, or undefined — record-level convenience. */
export function optStrField(body: JsonRecord | undefined, key: string, maxLen = 10_000): string | undefined {
  return optStr(body?.[key], maxLen);
}

/** finite number, or undefined (integers included — use optInt for the integer-only contract). */
export function optNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** safe integer, or undefined (money in kobo MUST pass through this or reqInt). */
export function optInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : undefined;
}

/** boolean, or undefined. */
export function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** unknown[] (possibly empty), or undefined when the value is not an array. */
export function optArr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

/** array of strings (non-string entries dropped), or undefined when the value is not an array. */
export function optStrArr(v: unknown, maxLen = 10_000): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string" && x.length <= maxLen);
}

/** plain object, or undefined. */
export function optObj(v: unknown): JsonRecord | undefined {
  return isObj(v) ? v : undefined;
}

// ── req* family — fail-fast boundary validation (400) ────────────────────────

function missing(key: string): never {
  throw new ApiError(400, "bad_request", `${key} is required.`);
}

/** string that must be present (non-empty after no trimming — caller trims). Throws 400. */
export function reqStr(body: JsonRecord | undefined, key: string, maxLen = 10_000): string {
  const v = optStr(body?.[key], maxLen);
  if (v === undefined || v === "") missing(key);
  return v;
}

/** finite number that must be present. Throws 400. */
export function reqNum(body: JsonRecord | undefined, key: string): number {
  const v = optNum(body?.[key]);
  if (v === undefined) missing(key);
  return v;
}

/** safe integer that must be present (use for kobo amounts). Throws 400. */
export function reqInt(body: JsonRecord | undefined, key: string): number {
  const v = optInt(body?.[key]);
  if (v === undefined) missing(key);
  return v;
}

/** boolean that must be present. Throws 400. */
export function reqBool(body: JsonRecord | undefined, key: string): boolean {
  const v = optBool(body?.[key]);
  if (v === undefined) missing(key);
  return v;
}

/** array that must be present (may be empty). Throws 400. */
export function reqArr(body: JsonRecord | undefined, key: string): unknown[] {
  const v = optArr(body?.[key]);
  if (v === undefined) missing(key);
  return v;
}

/** plain object that must be present. Throws 400. */
export function reqObj(body: JsonRecord | undefined, key: string): JsonRecord {
  const v = optObj(body?.[key]);
  if (v === undefined) missing(key);
  return v;
}
