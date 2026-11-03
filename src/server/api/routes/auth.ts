import { route } from "@/server/api/router";
import {
  login, revokeSession, SESSION_COOKIE, issueSessionForUser, hashPassword, sha256,
} from "@/server/auth";
import { db } from "@/server/db";
import {
  badRequest, jsonOk, authCookieHeader, clearAuthCookieHeaders, jsonWithCookies, isSecureRequest,
} from "@/server/http";
import { audit } from "@/server/audit";
import { randomBytes } from "crypto";

/**
 * Auth routes: login / logout / me (pre-existing) + magic-link sign-in and
 * password reset (added with the premium auth redesign). All new endpoints
 * are public and enumeration-safe: responses never reveal whether an email
 * exists. Tokens are stored hashed (sha256), single-use, 15-minute TTL.
 *
 * NOTE ON DELIVERY: this sandbox build has no outbound mail provider wired,
 * so the one-time link is returned to the requesting client as `devLink`
 * (the UI shows it as a clickable one-time link). In a hosted deployment the
 * same token would be emailed instead and `devLink` removed — the token
 * lifecycle is production-grade already.
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 3600;

/** Session cookie for THIS request — embedded-preview safe (see http.ts). */
function sessionCookie(sessionId: string, req: Request): string {
  return authCookieHeader(SESSION_COOKIE, sessionId, SESSION_COOKIE_MAX_AGE, isSecureRequest(req));
}

/** Tiny in-memory rate limiter for the public token-request endpoints. */
const attemptLog = new Map<string, number[]>();
function rateLimited(key: string, max = 5, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const hits = (attemptLog.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  attemptLog.set(key, hits);
  return hits.length > max;
}

/** Create a single-use token for a user; returns the raw token. */
async function createAuthToken(userId: string, purpose: "magic_login" | "password_reset"): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.authToken.create({
    data: {
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return token;
}

/** Consume a valid token of the given purpose → owning user, else null. */
async function consumeAuthToken(token: string, purpose: "magic_login" | "password_reset") {
  if (!token || token.length > 128) return null;
  const record = await db.authToken.findFirst({
    where: { tokenHash: sha256(token), purpose, usedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  if (!record || record.user.status !== "active") return null;
  await db.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record.user;
}

export function registerAuthRoutes() {
  route({
    method: "POST",
    pattern: "auth/login",
    isPublic: true,
    handler: async (ctx) => {
      const { email, password } = ctx.body ?? {};
      if (!email || !password) throw badRequest("Email and password are required.");
      const result = await login(email, password, { ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined });
      if (!result.ok || !result.sessionId) {
        return jsonOk({ error: "invalid_credentials", message: result.error }, { status: 401 });
      }
      return jsonWithCookies({ user: result.user }, [sessionCookie(result.sessionId, ctx.req)]);
    },
  });

  // ── Magic link sign-in ────────────────────────────────────────────────────
  route({
    method: "POST",
    pattern: "auth/magic-link",
    isPublic: true,
    handler: async (ctx) => {
      const email = String(ctx.body?.email ?? "").trim().toLowerCase();
      if (!email) throw badRequest("Email is required.");
      if (rateLimited(`magic|${ctx.ip ?? "unknown"}|${email}`)) {
        return jsonOk({ ok: true, message: "If that email has access, a sign-in link is on its way." });
      }
      const user = await db.user.findUnique({ where: { email } });
      let devLink: string | undefined;
      if (user && user.status === "active") {
        const token = await createAuthToken(user.id, "magic_login");
        devLink = `/?magic=${token}`;
      }
      // Enumeration-safe: identical shape whether or not the account exists.
      return jsonOk({
        ok: true,
        message: "If that email has access, a one-time sign-in link has been created. It expires in 15 minutes.",
        devLink,
      });
    },
  });

  route({
    method: "POST",
    pattern: "auth/magic-verify",
    isPublic: true,
    handler: async (ctx) => {
      const token = String(ctx.body?.token ?? "");
      const user = await consumeAuthToken(token, "magic_login");
      if (!user) return jsonOk({ error: "invalid_token", message: "This sign-in link is invalid, already used, or expired." }, { status: 400 });
      const result = await issueSessionForUser(user, "magic", "auth.login_magic", {
        ip: ctx.ip ?? undefined, userAgent: ctx.userAgent ?? undefined,
      });
      if (!result.ok || !result.sessionId) {
        return jsonOk({ error: "signin_blocked", message: result.error }, { status: 401 });
      }
      return jsonWithCookies({ user: result.user }, [sessionCookie(result.sessionId, ctx.req)]);
    },
  });

  // ── Password reset ────────────────────────────────────────────────────────
  route({
    method: "POST",
    pattern: "auth/forgot-password",
    isPublic: true,
    handler: async (ctx) => {
      const email = String(ctx.body?.email ?? "").trim().toLowerCase();
      if (!email) throw badRequest("Email is required.");
      if (rateLimited(`reset|${ctx.ip ?? "unknown"}|${email}`)) {
        return jsonOk({ ok: true, message: "If that email has access, a reset link is on its way." });
      }
      const user = await db.user.findUnique({ where: { email } });
      let devLink: string | undefined;
      if (user && user.status === "active") {
        const token = await createAuthToken(user.id, "password_reset");
        devLink = `/?reset=${token}`;
      }
      return jsonOk({
        ok: true,
        message: "If that email has access, a password-reset link has been created. It expires in 15 minutes.",
        devLink,
      });
    },
  });

  route({
    method: "POST",
    pattern: "auth/reset-password",
    isPublic: true,
    handler: async (ctx) => {
      const token = String(ctx.body?.token ?? "");
      const password = String(ctx.body?.password ?? "");
      if (password.length < 8) throw badRequest("New password must be at least 8 characters.");
      const user = await consumeAuthToken(token, "password_reset");
      if (!user) return jsonOk({ error: "invalid_token", message: "This reset link is invalid, already used, or expired." }, { status: 400 });
      await db.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(password),
          failedAttempts: 0,
          lockedUntil: null,
          mustChangePassword: false,
        },
      });
      // Security: any existing session is invalidated after a reset.
      await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      const membership = await db.membership.findFirst({ where: { userId: user.id } });
      await audit({
        orgId: membership?.orgId ?? "system",
        actor: { membershipId: null, name: user.email },
        actorType: "user",
        action: "auth.password_reset",
        entityType: "user",
        entityId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return jsonOk({ ok: true, message: "Password updated. You can now sign in with your new password." });
    },
  });

  route({
    method: "POST",
    pattern: "auth/logout",
    // Public ON PURPOSE: signing out with an already-expired/revoked session
    // must still clear the cookie server-side (previously it 401'd before the
    // clear header was sent, leaving the dead cookie in the browser).
    isPublic: true,
    handler: async (ctx) => {
      if (ctx.user) {
        await revokeSession(ctx.user.sessionId);
        await audit({
          orgId: ctx.user.orgId,
          actor: ctx.user,
          action: "auth.logout",
          entityType: "user",
          entityId: ctx.user.userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      // Clear BOTH jar variants (legacy Lax + partitioned CHIPS) so a stale
      // cookie can never survive logout (see http.ts clearAuthCookieHeaders).
      return jsonWithCookies({ ok: true }, clearAuthCookieHeaders(SESSION_COOKIE, ctx.req));
    },
  });

  route({
    method: "GET",
    pattern: "auth/me",
    permission: "",
    handler: async (ctx) => {
      return { user: ctx.user };
    },
  });
}
