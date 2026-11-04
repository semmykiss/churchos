import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth";

/**
 * Partner (SaaS vendor) auth — backend only.
 * Completely separate principal from church-tenant users: separate table,
 * separate session table and a separate cookie, so a partner login and a
 * church login can coexist in the same browser without leaking scopes.
 *
 * Hardening (partner console security upgrade):
 * • login lockout — 8 failed attempts locks the account for 15 minutes
 *   (mirrors the church-user pattern in auth.ts)
 * • idle timeout — a partner session untouched for 20 minutes is revoked on
 *   next use; every successful resolution refreshes lastSeenAt
 * • session rotation — a fresh random session id is issued on every login
 */
export const PARTNER_COOKIE = "chms_partner_session";
const PARTNER_SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const PARTNER_IDLE_TTL_MS = 20 * 60 * 1000;
const PARTNER_MAX_FAILED_ATTEMPTS = 8;
const PARTNER_LOCK_MS = 15 * 60 * 1000;

export interface PartnerPrincipal {
  sessionId: string;
  partnerUserId: string;
  email: string;
  name: string;
}

export interface PartnerLoginResult {
  ok: boolean;
  error?: string;
  sessionId?: string;
  partner?: Omit<PartnerPrincipal, "sessionId">;
  /** Seconds until the lockout lifts — present only when error === "locked". */
  retryAfterSeconds?: number;
}

export async function partnerLogin(
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): Promise<PartnerLoginResult> {
  const user = await db.partnerUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Unknown/disabled accounts return the same generic failure — no enumeration.
  if (!user || user.status !== "active") return { ok: false, error: "Invalid partner credentials." };

  // Already locked? Report remaining lock time, never verify the password.
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      error: "locked",
      retryAfterSeconds: Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000)),
    };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    // ATOMIC increment — a read-modify-write here loses updates under
    // concurrent failures (under-counting → lockout never triggers). Decide
    // lockout from the RETURNED row, not the pre-read snapshot.
    const updated = await db.partnerUser.update({
      where: { id: user.id },
      data: { failedAttempts: { increment: 1 } },
    });
    if (updated.failedAttempts >= PARTNER_MAX_FAILED_ATTEMPTS) {
      // Threshold reached — lock for 15 minutes (second, conditional-free write;
      // only reachable when the counter just crossed the threshold).
      await db.partnerUser.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + PARTNER_LOCK_MS) },
      });
      return { ok: false, error: "locked", retryAfterSeconds: Math.ceil(PARTNER_LOCK_MS / 1000) };
    }
    return { ok: false, error: "Invalid partner credentials." };
  }

  // Success — reset the failure counter and rotate to a brand-new session id.
  await db.partnerUser.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const session = await db.partnerSession.create({
    data: {
      id: randomBytes(24).toString("hex"),
      partnerUserId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + PARTNER_SESSION_TTL_MS),
    },
  });

  return {
    ok: true,
    sessionId: session.id,
    partner: { partnerUserId: user.id, email: user.email, name: user.name },
  };
}

export async function getPartnerSessionUser(sessionId: string | undefined | null): Promise<PartnerPrincipal | null> {
  if (!sessionId) return null;
  const session = await db.partnerSession.findUnique({
    where: { id: sessionId },
    include: { partnerUser: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (session.partnerUser.status !== "active") return null;

  // Idle timeout — a session with no activity for 20 minutes is dead. Sessions
  // created before lastSeenAt existed carry null and get it stamped on first
  // use below (no rejection for legacy sessions).
  if (session.lastSeenAt && Date.now() - session.lastSeenAt.getTime() > PARTNER_IDLE_TTL_MS) {
    await revokePartnerSession(session.id);
    return null;
  }

  // Touch lastSeenAt on every successful use — fire-and-forget, never blocks
  // or fails the request.
  void db.partnerSession
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return {
    sessionId: session.id,
    partnerUserId: session.partnerUserId,
    email: session.partnerUser.email,
    name: session.partnerUser.name,
  };
}

export async function revokePartnerSession(sessionId: string) {
  await db.partnerSession.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}
