import { scryptSync, randomBytes, timingSafeEqual, createHash } from "crypto";
import { db } from "@/server/db";
import type { SessionUser } from "@/server/permissions";
import { ROLE_TEMPLATES, PERMISSIONS } from "@/server/permissions";
import { licenseGateForOrg } from "@/server/services/partner";

/**
 * Auth service (backend only).
 * • scrypt password hashing (no external deps; Windows-friendly)
 * • DB-backed sessions; cookie carries an opaque random id
 * • session revocation on logout / deactivation
 * • audit of login events
 */
export const SESSION_COOKIE = "chms_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // sessions last (P4: "Sessions last.")

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  user?: SessionUser;
  sessionId?: string;
}

export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.status !== "active") return { ok: false, error: "Invalid email or password." };
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return { ok: false, error: "Account temporarily locked. Try again later." };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedAttempts + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: failed,
        lockedUntil: failed >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });
    await writeLoginAudit(user.id, user.email, "auth.login_failed", meta);
    return { ok: false, error: "Invalid email or password." };
  }

  // first active membership across tenants (a user email lives in one church per deployment).
  // pending_verification tenants may sign in and use non-payment features
  // immediately (tenant onboarding spec §2 step 2) — payments are gated
  // separately in the giving service, and suspension still blocks everything.
  const membership = await db.membership.findFirst({
    where: { userId: user.id, status: "active", org: { status: { in: ["active", "pending_verification"] } } },
    include: {
      org: true,
      roleAssignments: { include: { role: { include: { permissions: true } } } },
    },
    orderBy: { joinedAt: "asc" },
  });
  if (!membership) return { ok: false, error: "No active membership for this account." };

  // license gate — enforced BEFORE any session is issued
  const gate = await licenseGateForOrg(membership.orgId);
  if (!gate.ok) {
    await writeLoginAudit(user.id, user.email, "auth.login_blocked", meta);
    return { ok: false, error: gate.message };
  }

  const perms = expandPermissions(membership.roleAssignments.map((ra) => ra.role.permissions.map((p) => p.permission)));
  applyGivingVisibilitySetting(perms, membership.org.settings);
  const session = await db.session.create({
    data: {
      id: randomBytes(24).toString("hex"),
      userId: user.id,
      membershipId: membership.id,
      amr: "pwd",
      ip: meta.ip, userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  await db.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await db.session.updateMany({
    where: { userId: user.id, id: { not: session.id }, revokedAt: null, createdAt: { lt: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
    data: { revokedAt: new Date() },
  });
  await writeLoginAudit(user.id, user.email, "auth.login", meta);

  const campus = membership.defaultCampusId
    ? await db.campus.findUnique({ where: { id: membership.defaultCampusId } })
    : await db.campus.findFirst({ where: { orgId: membership.orgId, isPrimary: true } });

  return {
    ok: true,
    sessionId: session.id,
    user: {
      sessionId: session.id,
      userId: user.id,
      membershipId: membership.id,
      orgId: membership.orgId,
      orgName: membership.org.name,
      campusId: campus?.id ?? null,
      campusName: campus?.name ?? null,
      email: user.email,
      name: user.name ?? user.email,
      personId: membership.personId,
      roleKeys: membership.roleAssignments.map((ra) => ra.role.key),
      roleNames: [...new Set(membership.roleAssignments.map((ra) => ra.role.name))],
      permissions: perms,
      amr: "pwd",
    },
  };
}

async function writeLoginAudit(userId: string, email: string, action: string, meta: { ip?: string; userAgent?: string }) {
  const membership = await db.membership.findFirst({ where: { userId } });
  await db.auditLog.create({
    data: {
      orgId: membership?.orgId ?? "system",
      actorMembershipId: membership?.id ?? null,
      actorType: "user",
      actorLabel: email,
      action,
      entityType: "user",
      entityId: userId,
      ip: meta.ip, userAgent: meta.userAgent,
    },
  });
}

export function expandPermissions(bundles: string[][]): string[] {
  const out = new Set<string>();
  for (const bundle of bundles) {
    for (const p of bundle) {
      // expand wildcards so CLIENT-side gating (includes()) sees concrete grants;
      // the server can() additionally resolves wildcards defensively.
      if (p === "*") {
        for (const perm of PERMISSIONS) out.add(perm);
        continue;
      }
      if (p.endsWith(".*")) {
        const prefix = p.slice(0, -1); // keep the dot
        for (const perm of PERMISSIONS) if (perm.startsWith(prefix)) out.add(perm);
        continue;
      }
      out.add(p);
    }
  }
  return [...out];
}

/**
 * Church setting `pastorCanViewIndividualGiving` (default FALSE): roles holding
 * the candidate permission "giving.view.pastor" see individual gift histories
 * only when the church has explicitly opted in. Aggregate oversight
 * (accounting.view) is unaffected. Mutates `perms` in place.
 */
export function applyGivingVisibilitySetting(perms: string[], orgSettings: string | null | undefined) {
  if (!perms.includes("giving.view.pastor") || perms.includes("giving.view.all")) return;
  let enabled = false;
  try {
    const settings = orgSettings ? (JSON.parse(orgSettings) as Record<string, unknown>) : {};
    enabled = settings?.pastorCanViewIndividualGiving === true;
  } catch {
    enabled = false;
  }
  if (enabled) perms.push("giving.view.all");
}

export async function getSessionUser(sessionId: string | undefined | null): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      user: true,
      membership: {
        include: {
          org: true,
          roleAssignments: { include: { role: { include: { permissions: true } } } },
        },
      },
    },
  });
  if (!session || !session.membership || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.status !== "active" || session.membership.status !== "active") return null;
  // suspended/archived tenants lose access immediately. pending_verification
  // tenants stay signed in — their limitation is payments (see giving.ts),
  // which keeps a new church usable from day one while CAC review completes.
  if (!["active", "pending_verification"].includes(session.membership.org.status)) return null;

  const membership = session.membership;
  const perms = expandPermissions(membership.roleAssignments.map((ra) => ra.role.permissions.map((p) => p.permission)));
  applyGivingVisibilitySetting(perms, membership.org.settings);
  const campus = membership.defaultCampusId
    ? await db.campus.findUnique({ where: { id: membership.defaultCampusId } })
    : await db.campus.findFirst({ where: { orgId: membership.orgId, isPrimary: true } });

  return {
    sessionId: session.id,
    userId: session.userId,
    membershipId: membership.id,
    orgId: membership.orgId,
    orgName: membership.org.name,
    campusId: campus?.id ?? null,
    campusName: campus?.name ?? null,
    email: session.user.email,
    name: session.user.name ?? session.user.email,
    personId: membership.personId,
    roleKeys: membership.roleAssignments.map((ra) => ra.role.key),
    roleNames: [...new Set(membership.roleAssignments.map((ra) => ra.role.name))],
    permissions: perms,
    amr: session.amr,
  };
}

export async function revokeSession(sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

/** Validate a kiosk token → scoped kiosk principal. */
export async function getKioskContext(kioskToken: string) {
  const cs = await db.checkinSession.findUnique({
    where: { kioskToken },
    include: { event: true },
  });
  if (!cs || cs.closedAt || cs.closesAt.getTime() < Date.now()) return null;
  return cs;
}

/** Tokenized assignment links (no-login accept/decline). */
export function newResponseToken(): string {
  return "tok_" + randomBytes(12).toString("hex");
}
