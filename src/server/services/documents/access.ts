/**
 * Documents access model (backend only) — the single place where the DMS
 * decides who sees what. Server-enforced on every endpoint; the UI only mirrors
 * these decisions (hiding a button is not a permission).
 *
 * Two layers:
 *   1. COARSE access levels (public/members/staff/leaders/finance/pastoral) —
 *      each viewer session gets a rank 0..4; a document is visible when its
 *      level's rank ≤ viewer rank. Rank comes from role keys AND permission
 *      keys so custom roles work too.
 *   2. PER-DOCUMENT ACL overrides — user/role/department grants (read/edit/
 *      manage) lift visibility, and "deny" always wins (hidden + 403).
 */
import { can, type SessionUser } from "@/server/permissions";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { ACCESS_RANK_ALLOWED, type DocumentAccessLevel } from "@/features/documents/constants";

/** Preset role keys that count as "staff" (custom roles fall back to permission keys). */
const STAFF_ROLE_KEYS = new Set(["owner", "campus_admin", "finance", "pastor", "head_usher", "minister", "ministry_leader"]);
const LEADER_ROLE_KEYS = new Set(["owner", "campus_admin", "pastor", "minister", "ministry_leader"]);
const FINANCE_ROLE_KEYS = new Set(["owner", "campus_admin", "finance"]);
const PASTORAL_ROLE_KEYS = new Set(["owner", "campus_admin", "pastor"]);

const inAnyRole = (user: SessionUser, keys: Set<string>) => user.roleKeys.some((k) => keys.has(k));

/** Highest access rank the viewer satisfies: 0 public · 1 staff · 2 leaders · 3 finance · 4 pastoral. */
export function viewerRank(user: SessionUser): number {
  let rank = 0; // everyone with documents.view is at least members-level
  if (can(user, "documents.edit") || can(user, "documents.create") || inAnyRole(user, STAFF_ROLE_KEYS)) rank = 1;
  if (can(user, "documents.approve") || inAnyRole(user, LEADER_ROLE_KEYS)) rank = Math.max(rank, 2);
  if (can(user, "accounting.manage") || inAnyRole(user, FINANCE_ROLE_KEYS)) rank = Math.max(rank, 3);
  if (can(user, "care.risk.view.all") || inAnyRole(user, PASTORAL_ROLE_KEYS)) rank = Math.max(rank, 4);
  return rank;
}

/** Access levels visible at a given rank (mirrors ACCESS_RANK_ALLOWED). */
export function allowedLevelsFor(rank: number): DocumentAccessLevel[] {
  return ACCESS_RANK_ALLOWED[Math.max(0, Math.min(4, rank))];
}

/** Group (department) ids the viewer belongs to — for department ACL grants. */
export async function viewerDepartmentIds(user: SessionUser): Promise<string[]> {
  if (!user.personId) return [];
  const rows = await db.groupMember.findMany({
    where: { orgId: user.orgId, personId: user.personId, status: "active" },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

/**
 * Prisma WHERE for everything the viewer may see. Always org-scoped.
 *  - trash=false → live documents; trash=true → only trashed ones
 *  - includeInfected → quarantine review (documents.delete holders only)
 *  - baseFilters → extra AND conditions (search/category/…)
 */
export async function visibleWhere(
  user: SessionUser,
  opts: { trash?: boolean; includeInfected?: boolean } = {},
  baseFilters: Prisma.DocumentWhereInput[] = []
): Promise<Prisma.DocumentWhereInput> {
  const rank = viewerRank(user);
  const levels = allowedLevelsFor(rank);
  const deptIds = await viewerDepartmentIds(user);

  const grantClauses: Prisma.DocumentWhereInput[] = [
    { accessLevel: { in: levels } },
    { acls: { some: { subjectType: "user", subjectId: user.membershipId, level: { in: ["read", "edit", "manage"] } } } },
    { acls: { some: { subjectType: "role", subjectId: { in: user.roleKeys.length ? user.roleKeys : ["__none__"] }, level: { in: ["read", "edit", "manage"] } } } },
  ];
  if (deptIds.length) {
    grantClauses.push({ acls: { some: { subjectType: "department", subjectId: { in: deptIds }, level: { in: ["read", "edit", "manage"] } } } });
  }

  return {
    orgId: user.orgId,
    deletedAt: opts.trash ? { not: null } : null,
    ...(opts.includeInfected ? {} : { scanStatus: { not: "infected" } }),
    AND: [
      { OR: grantClauses },
      // user-scoped deny always wins — the document is hidden entirely
      { acls: { none: { subjectType: "user", subjectId: user.membershipId, level: "deny" } } },
      // Unpublished drafts / in-review items are only for editors+ (the
      // approval workflow exists to prevent premature disclosure). Read-only
      // viewers still see them when they hold an explicit ACL grant.
      ...(rank >= 1
        ? []
        : [{
            OR: [
              { status: { notIn: ["draft", "in_review"] } },
              { acls: { some: { subjectType: "user", subjectId: user.membershipId, level: { in: ["read", "edit", "manage"] } } } },
            ],
          }]),
      ...baseFilters,
    ],
  };
}

export interface DocRightsInput {
  id: string;
  ownerId: string | null;
  scanStatus: string;
  downloadRestricted: boolean;
  legalHold: boolean;
  lockedById: string | null;
  status: string;
}

/** Compute viewer-relative rights for one document given its ACL rows. */
export function docRights(
  user: SessionUser,
  doc: DocRightsInput,
  acls: { subjectType: string; subjectId: string; level: string }[]
): { mine: boolean; canEdit: boolean; canDownload: boolean; canShare: boolean; canPreview: boolean; lockedByOther: boolean; denied: boolean } {
  const mine = doc.ownerId === user.membershipId;
  const denied = acls.some((a) =>
    a.level === "deny" &&
    ((a.subjectType === "user" && a.subjectId === user.membershipId) ||
      (a.subjectType === "role" && user.roleKeys.includes(a.subjectId)))
  );
  const editGrant = acls.some((a) =>
    (a.level === "edit" || a.level === "manage") &&
    ((a.subjectType === "user" && a.subjectId === user.membershipId) ||
      (a.subjectType === "role" && user.roleKeys.includes(a.subjectId)))
  );
  const lockedByOther = Boolean(doc.lockedById && doc.lockedById !== user.membershipId);
  const baseEdit = (can(user, "documents.edit") || (mine && can(user, "documents.create"))) && !denied;
  const canEdit = (baseEdit || (editGrant && !denied)) && !lockedByOther;
  const canDownload =
    !denied &&
    doc.scanStatus !== "infected" &&
    (!doc.downloadRestricted || can(user, "documents.delete"));
  const canShare = can(user, "documents.share") && !denied && !doc.downloadRestricted;
  const canPreview = !denied && doc.scanStatus !== "infected";
  return { mine, canEdit, canDownload, canShare, canPreview, lockedByOther, denied };
}
