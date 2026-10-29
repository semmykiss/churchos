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
