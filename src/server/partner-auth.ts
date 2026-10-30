import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth";

/**
 * Partner (SaaS vendor) auth — backend only.
 * Completely separate principal from church-tenant users: separate table,
 * separate session table and a separate cookie, so a partner login and a
 * church login can coexist in the same browser without leaking scopes.
 */
export const PARTNER_COOKIE = "chms_partner_session";
const PARTNER_SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

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
}

export async function partnerLogin(
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): Promise<PartnerLoginResult> {
  const user = await db.partnerUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.status !== "active") return { ok: false, error: "Invalid partner credentials." };
  if (!verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Invalid partner credentials." };
  }

  const session = await db.partnerSession.create({
    data: {
      id: randomBytes(24).toString("hex"),
      partnerUserId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + PARTNER_SESSION_TTL_MS),
    },
  });
  await db.partnerUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

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
