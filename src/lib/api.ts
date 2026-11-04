/**
 * Typed API client (FRONTEND ONLY — never imported by server code).
 * All requests go to /api/v1/* relative paths.
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

async function request<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? res.statusText, data?.details);
  }
  return data as T;
}

export interface RequestOptions {
  /** Extra request headers, e.g. { "Idempotency-Key": "..." }. */
  headers?: Record<string, string>;
}

export const api = {
  get: <T,>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T,>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body ?? {}, options),
  put: <T,>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body ?? {}, options),
  patch: <T,>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body ?? {}, options),
  del: <T,>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

/** Build query string, skipping null/undefined/empty. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Extract the underlying kiosk token error code from an ApiError. */
export function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    const d = err.details as any;
    return d?.code ?? err.code;
  }
  return undefined;
}
