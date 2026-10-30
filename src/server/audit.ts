import { db } from "@/server/db";
import type { SessionUser } from "@/server/permissions";

/**
 * Append-only audit service (backend only).
 * Every write to people / money / care / roles / exports goes through here
 * in the same logical step as the mutation (04-architecture §3.10, F rule 6).
 */
export interface AuditEntry {
  orgId: string;
  actor?: Pick<SessionUser, "membershipId" | "name"> | null;
  actorType?: "user" | "system" | "support";
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function audit(entry: AuditEntry) {
  const snap = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));
  await db.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorMembershipId: entry.actor?.membershipId ?? null,
      actorType: entry.actorType ?? "user",
      actorLabel: entry.actor?.name ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: snap(entry.before),
      after: snap(entry.after),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}

/** Parse JSON columns safely. */
export function j<T = any>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
