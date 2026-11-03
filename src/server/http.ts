/**
 * HTTP helpers for the API layer (backend only).
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Sign in required.") => new ApiError(401, "unauthorized", msg);
export const forbidden = (msg = "You do not have permission to do that.") => new ApiError(403, "forbidden", msg);
export const notFound = (msg = "Not found.") => new ApiError(404, "not_found", msg);
export const conflict = (msg: string, details?: unknown) => new ApiError(409, "conflict", msg, details);

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

// ── Session cookie builder (embedded-preview safe) ──────────────────────────
// The app is embedded in the preview panel as a CROSS-SITE iframe. A
// SameSite=Lax cookie is rejected there (third-party cookie blocking), so
// login returned 200 while every later request came back 401 — the "app
// failed" report. Over HTTPS we therefore issue the cookie as
// `SameSite=None; Secure; Partitioned` (CHIPS): it is stored per top-level
// site and survives embedded iframes, while first-party (new-tab) usage
// keeps working unchanged. Plain HTTP (local dev) keeps the legacy Lax form
// because `Secure` cookies are dropped on non-HTTPS origins.

/** True when the request arrived over HTTPS (gateway sets x-forwarded-proto). */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim().toLowerCase() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** One Set-Cookie header for an auth session cookie, adapted to the request. */
export function authCookieHeader(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const base = `${name}=${value}; Path=/; HttpOnly; Max-Age=${maxAgeSeconds}`;
  return secure ? `${base}; SameSite=None; Secure; Partitioned` : `${base}; SameSite=Lax`;
}

/**
 * ALL Set-Cookie variants needed to fully clear an auth cookie. A browser can
 * hold the same cookie name in two jars (legacy unpartitioned Lax + current
 * partitioned CHIPS), so logout clears BOTH — otherwise one survives and the
 * user appears still-signed-in. The partitioned variant is only emitted over
 * HTTPS (browsers reject `Secure` cookies on plain HTTP).
 */
export function clearAuthCookieHeaders(name: string, req: Request): string[] {
  const headers = [`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
  if (isSecureRequest(req)) {
    headers.push(`${name}=; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=0`);
  }
  return headers;
}

/** jsonOk with one or more Set-Cookie headers appended correctly (no comma-joining). */
export function jsonWithCookies(data: unknown, cookies: string[], init?: ResponseInit): Response {
  const res = jsonOk(data, init);
  for (const cookie of cookies) res.headers.append("set-cookie", cookie);
  return res;
}
