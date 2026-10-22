// ChurchOS — Simple in-memory rate limiter for write APIs.
// Usage: import { rateLimit } from '@/lib/rate-limiter'
//        if (!rateLimit(ctx.user.id, 'members.create', 10, 60_000)) throw new ForbiddenError('Rate limit exceeded')

const buckets = new Map<string, { count: number; first: number }>()

export function rateLimit(
  key: string,
  action: string,
  max: number = 10,
  windowMs: number = 60_000,
): boolean {
  const compositeKey = `${key}:${action}`
  const now = Date.now()
  const entry = buckets.get(compositeKey)
  if (!entry || now - entry.first > windowMs) {
    buckets.set(compositeKey, { count: 1, first: now })
    return true
  }
  entry.count += 1
  return entry.count <= max
}

// Clean up old entries periodically (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of buckets.entries()) {
      if (now - entry.first > 300_000) buckets.delete(key)
    }
  }, 300_000)
}
