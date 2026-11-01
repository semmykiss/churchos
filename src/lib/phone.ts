/**
 * Phone normalization & display helpers (People CRM — Phase 1).
 *
 * Pure + isomorphic: safe to import from server services AND client
 * components. No side effects, never throws — an unparseable input returns
 * `null` so callers can decide what to do (backfill keeps the original).
 *
 * Nigerian conventions:
 *   • store E.164 with the +234 country code (e.g. "+2348031234567")
 *   • accept what Nigerians actually type:
 *       "0803 123 4567" · "08031234567" · "8031234567" ·
 *       "+234 803 123 4567" · "2348031234567" · "+23408031234567"
 *   • display national format: "0803 123 4567"
 *
 * Nigerian NSN (national significant number) = 10 digits:
 *   mobile  → starts 703…706 / 802…809 / 901…913  (first digit 7, 8 or 9)
 *   landline→ 01 (Lagos), 02… (Ibadan, Abeokuta…), 09 (Abuja)
 */

export const DEFAULT_COUNTRY = "NG";
export const DEFAULT_COUNTRY_CODE = "+234";

/** Characters people sprinkle into phone numbers. */
const NOISE = /[\s()\-.·/_]/g;

/** A valid Nigerian NSN: 10 digits starting 1, 2, 7, 8 or 9. */
function isValidNigerianNsn(nsn: string): boolean {
  return /^\d{10}$/.test(nsn) && /^[12789]/.test(nsn);
}

/**
 * Normalize a human-typed phone number to E.164.
 *
 * Returns `null` when the input cannot be parsed — callers must keep the
 * raw value instead of guessing. Numbers with an explicit non-Nigerian
 * country code (e.g. "+441234567890") pass through untouched.
 */
export function normalizeToE164(
  input: string | null | undefined,
  defaultCountry: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).trim().replace(NOISE, "");
  if (!cleaned) return null;

  // 00 international prefix → "+"
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : cleaned.startsWith("00")
      ? `+${cleaned.slice(2)}`
      : cleaned;

  if (withPlus.startsWith("+")) {
    const digits = withPlus.slice(1).replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return null;
    // +234 (+ optional stray leading 0, e.g. "+2340803…") → canonicalize
    if (digits.startsWith("234")) {
      let nsn = digits.slice(3);
      if (nsn.length === 11 && nsn.startsWith("0")) nsn = nsn.slice(1);
      if (isValidNigerianNsn(nsn)) return `+234${nsn}`;
      return null;
    }
    return `+${digits}`;
  }

  // Local formats — only meaningful for the default country (Nigeria).
  if (defaultCountry !== DEFAULT_COUNTRY_CODE) return null;
  const digits = withPlus.replace(/\D/g, "");
  let nsn: string | null = null;
  if (digits.startsWith("234")) {
    nsn = digits.slice(3);
    if (nsn.length === 11 && nsn.startsWith("0")) nsn = nsn.slice(1);
  } else if (digits.startsWith("0")) {
    nsn = digits.slice(1);
  } else if (digits.length === 10) {
    nsn = digits; // "8031234567" — typed without the trunk 0
  }
  if (nsn && isValidNigerianNsn(nsn)) return `+234${nsn}`;
  return null;
}

/** True when the E.164 number is a Nigerian MOBILE (vs landline). */
export function isNigerianMobile(e164: string | null | undefined): boolean {
  if (!e164) return false;
  return /^\+234[789]\d{9}$/.test(e164);
}

/**
 * Human display for an E.164 number: "+2348031234567" → "0803 123 4567".
 * Mobiles group 4-3-3, landlines 2-3-4 ("01 234 5678"). Any other country
 * renders as plain E.164. Returns `null` for null/blank input.
 */
export function formatPhoneDisplay(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const value = String(e164).trim();
  if (!value.startsWith("+234")) return value;
  const nsn = value.slice(4);
  if (!/^\d{10}$/.test(nsn)) return value;
  const national = `0${nsn}`;
  if (/^[12]/.test(nsn)) {
    return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`; // 01 234 5678
  }
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`; // 0803 123 4567
}

/** Normalize for duplicate matching — same as normalizeToE164 (kept for intent). */
export function normalizePhoneForMatch(input: string | null | undefined): string | null {
  return normalizeToE164(input);
}
