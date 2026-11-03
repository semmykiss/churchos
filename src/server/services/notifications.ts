import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/http";
import { parseAccessMatrix, permissionsForMatrix, type SessionUser } from "@/server/permissions";

/**
 * Notifications service (backend only) — the cross-module inbox behind the
 * topbar bell. Any module can raise notifications for specific users via
 * `pushNotifications`:
 *   • chat        → new message in a conversation the user belongs to
 *   • volunteers  → scheduled for a serving role
 *   • care        → urgent/high-urgency case opened (targeted at care viewers)
 * Delivery is pull-based: the bell polls the unread count and the latest
 * entries; opening a conversation/entity marks the related rows read.
 */

const MAX_BODY = 500;
const LIST_LIMIT = 30;

export interface PushInput {
  orgId: string;
  userIds: string[];
  module: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  linkModule?: string;
}

/** Create notification rows for a set of recipient users (deduped, sender excluded by caller). */
export async function pushNotifications(input: PushInput): Promise<void> {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (!userIds.length) return;
  const body = input.body?.slice(0, MAX_BODY);
  await db.notification.createMany({
    data: userIds.map((userId) => ({
      orgId: input.orgId,
      userId,
      module: input.module,
      type: input.type,
      title: input.title.slice(0, 200),
      body: body || null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      linkModule: input.linkModule ?? null,
    })),
  });
}

/** Resolve the User.ids linked to a set of personIds (active memberships only). */
export async function userIdsForPersons(orgId: string, personIds: string[]): Promise<string[]> {
  const ids = [...new Set(personIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = await db.membership.findMany({
    where: { orgId, personId: { in: ids }, status: "active", user: { status: "active" } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId).filter(Boolean);
}

/**
 * Resolve every active user in the org holding a permission (wildcard-aware).
 * Grants are read from BOTH sources the session build honours: explicit
 * RolePermission rows AND keys derived from the role's accessMatrix ladder —
 * a role that only carries the matrix (no permission rows) still resolves.
 */
export async function userIdsWithPermission(orgId: string, permission: string): Promise<string[]> {
  if (!permission) return [];
  const memberships = await db.membership.findMany({
    where: { orgId, status: "active", user: { status: "active" } },
    select: {
      userId: true,
      roleAssignments: {
        select: {
          role: {
            select: {
              accessMatrix: true,
              permissions: { select: { permission: true } },
            },
          },
        },
      },
    },
  });
  const out: string[] = [];
  for (const m of memberships) {
    const perms = m.roleAssignments.flatMap((ra) => {
      const keys = ra.role.permissions.map((p) => p.permission);
      const matrix = parseAccessMatrix(ra.role.accessMatrix);
      if (matrix) keys.push(...permissionsForMatrix(matrix));
      return keys;
    });
    const granted = perms.some(
      (p) => p === "*" || p === permission || (p.endsWith(".*") && permission.startsWith(p.slice(0, -1))),
    );
    if (granted) out.push(m.userId);
  }
  return out;
}

/* ───────────────────────────── user inbox ───────────────────────────── */

function toDTO(n: {
  id: string;
  module: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  linkModule: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return { ...n, read: !!n.readAt };
}

export async function listNotifications(user: SessionUser) {
  const rows = await db.notification.findMany({
    where: { orgId: user.orgId, userId: user.userId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  const unread = await db.notification.count({
    where: { orgId: user.orgId, userId: user.userId, readAt: null },
  });
  return { items: rows.map(toDTO), unread };
}

export async function unreadCount(user: SessionUser) {
  const unread = await db.notification.count({
    where: { orgId: user.orgId, userId: user.userId, readAt: null },
  });
  return { unread };
}

export async function markRead(user: SessionUser, id: string) {
  if (!id) throw badRequest("Notification id is required.");
  const row = await db.notification.findFirst({ where: { id, orgId: user.orgId, userId: user.userId } });
  if (!row) throw notFound("Notification not found.");
  if (!row.readAt) {
    await db.notification.update({ where: { id: row.id }, data: { readAt: new Date() } });
  }
  return { ok: true };
}

export async function markAllRead(user: SessionUser) {
  await db.notification.updateMany({
    where: { orgId: user.orgId, userId: user.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

/** Mark every notification pointing at one entity as read (e.g. a chat conversation was opened). */
export async function markEntityRead(user: SessionUser, entityType: string, entityId: string) {
  await db.notification.updateMany({
    where: {
      orgId: user.orgId, userId: user.userId,
      entityType, entityId, readAt: null,
    },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
