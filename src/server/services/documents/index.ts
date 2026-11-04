/**
 * Documents (DMS) service (backend only) — every function is tenant-scoped and
 * re-checks permissions server-side; the router gate is the OUTER check only.
 *
 * Conventions follow the rest of the codebase:
 *   • orgId from the session, never from the client
 *   • actor fields stored as id + denormalized display name
 *   • immutable audit through src/server/audit.ts (entityType "document")
 *   • JSON columns are strings; money untouched (DMS carries no money)
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/server/db";
import { ApiError, badRequest, forbidden, notFound, conflict } from "@/server/http";
import { can, type SessionUser } from "@/server/permissions";
import type { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/auth";
import { pushNotifications, userIdsWithPermission } from "@/server/services/notifications";
import { storage, documentStorageKey } from "./storage";
import { cleanFileName, sha256Hex, sniff, extMimeConsistent } from "./validate";
import { viewerRank, allowedLevelsFor, visibleWhere, docRights } from "./access";
import { checkRate } from "./rate-limit";
import {
  DOCUMENT_CATEGORIES,
  ACCESS_LEVELS_DMS,
  ACCESS_LEVEL_META,
  STATUS_TRANSITIONS,
  fileKindFromMime,
  type DocumentCategory,
  type DocumentAccessLevel,
} from "@/features/documents/constants";
import type { DocumentMetaInput } from "@/features/documents/schemas";
import type {
  DocumentDTO,
  DocumentsListResp,
  DocumentsStats,
  DocumentDetailResp,
  DocumentVersionDTO,
  ShareLinkDTO,
  DocumentCommentDTO,
  DocumentsSettingsDTO,
  FolderDTO,
} from "@/features/documents/types";
import { extOf } from "@/features/documents/utils";
import { j } from "@/server/audit";

type Meta = { ip?: string | null; userAgent?: string | null };

// ── helpers ──────────────────────────────────────────────────────────────────

const EICAR_SCAN_DISABLED_NOTE = "scan disabled";

function jParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function dateOrNull(input?: string | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getSettingsRow(orgId: string) {
  return db.documentSettings.upsert({
    where: { orgId },
    update: {},
    create: { orgId },
  });
}

/** Rank required to SET a given access level — prevents privilege escalation. */
function assertCanSetAccessLevel(user: SessionUser, level: string) {
  const meta = ACCESS_LEVEL_META[level as DocumentAccessLevel];
  if (!meta) throw badRequest("Unknown access level.");
  if (viewerRank(user) < meta.rank) {
    throw forbidden(`You cannot classify documents as "${meta.label}" — that level is above your own access.`);
  }
}

async function loadVisibleDocument(user: SessionUser, id: string, opts: { trash?: boolean; includeInfected?: boolean } = {}) {
  // CRITICAL: single-document reads go through the SAME visibility where-clause
  // as lists (access rank + ACL grants + deny) — a guessed id must 404 exactly
  // like a filtered-out list row, never leak.
  const where = await visibleWhere(user, opts);
  const doc = await db.document.findFirst({
    where: { AND: [where, { id }] },
    include: {
      tags: { include: { tag: true } },
      folder: { select: { name: true } },
      acls: true,
    },
  });
  if (!doc) throw notFound("Document not found.");
  const rights = docRights(user, doc, doc.acls);
  if (rights.denied) throw notFound("Document not found.");
  return { doc, rights };
}

function assertNotLocked(doc: { lockedById: string | null; lockedByName: string | null }, user: SessionUser, action = "edit") {
  if (doc.lockedById && doc.lockedById !== user.membershipId) {
    throw conflict(`This document is checked out by ${doc.lockedByName ?? "another user"} — ask them to check it in before you can ${action} it.`);
  }
}

/** Where clause component for the "kind" filter (mime groups). */
function kindFilter(kind: string): Prisma.DocumentWhereInput | null {
  const map: Record<string, Prisma.DocumentWhereInput> = {
    pdf: { mimeType: "application/pdf" },
    image: { mimeType: { startsWith: "image/" } },
    word: { OR: [{ mimeType: { contains: "word" } }, { mimeType: { contains: "document" } }] },
    excel: { OR: [{ mimeType: { contains: "excel" } }, { mimeType: { contains: "spreadsheet" } }, { mimeType: "text/csv" }] },
    powerpoint: { OR: [{ mimeType: { contains: "powerpoint" } }, { mimeType: { contains: "presentation" } }] },
    text: { mimeType: { startsWith: "text/" } },
  };
  return map[kind] ?? null;
}

// ── serializers ──────────────────────────────────────────────────────────────

function favoriteIdsFor(user: SessionUser, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return Promise.resolve(new Set());
  return db.documentFavorite
    .findMany({ where: { membershipId: user.membershipId, documentId: { in: ids } }, select: { documentId: true } })
    .then((rows) => new Set(rows.map((r) => r.documentId)));
}

async function serializeDocs(
  user: SessionUser,
  docs: (Parameters<typeof docRights>[1] & {
    id: string; title: string; description: string | null; category: string; accessLevel: string; status: string;
    folderId: string | null; folder?: { name: string } | null; currentVersion: number; versionCount: number;
    fileName: string; mimeType: string; byteSize: number; scanStatus: string; ownerId: string | null; ownerName: string | null;
    expiresAt: Date | null; reviewAt: Date | null; legalHold: boolean; downloadRestricted: boolean; watermark: boolean;
    lockedById: string | null; lockedByName: string | null; lockedAt: Date | null; viewCount: number; downloadCount: number;
    approvedByName: string | null; approvedAt: Date | null; workflowNote: string | null; deletedAt: Date | null;
    createdAt: Date; updatedAt: Date; tags: { tag: { id: string; name: string; color: string } }[]; acls: { subjectType: string; subjectId: string; level: string }[];
  })[]
): Promise<DocumentDTO[]> {
  const favs = await favoriteIdsFor(user, docs.map((d) => d.id));
  return docs.map((doc) => {
    const rights = docRights(user, doc, doc.acls);
    return {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      category: doc.category,
      accessLevel: doc.accessLevel,
      status: doc.status,
      folderId: doc.folderId,
      folderName: doc.folder?.name ?? null,
      currentVersion: doc.currentVersion,
      versionCount: doc.versionCount,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      byteSize: doc.byteSize,
      fileKind: fileKindFromMime(doc.mimeType),
      scanStatus: doc.scanStatus,
      ownerId: doc.ownerId,
      ownerName: doc.ownerName,
      expiresAt: doc.expiresAt?.toISOString() ?? null,
      reviewAt: doc.reviewAt?.toISOString() ?? null,
      legalHold: doc.legalHold,
      downloadRestricted: doc.downloadRestricted,
      watermark: doc.watermark,
      lockedById: doc.lockedById,
      lockedByName: doc.lockedByName,
      lockedAt: doc.lockedAt?.toISOString() ?? null,
      viewCount: doc.viewCount,
      downloadCount: doc.downloadCount,
      approvedByName: doc.approvedByName,
      approvedAt: doc.approvedAt?.toISOString() ?? null,
      workflowNote: doc.workflowNote,
      deletedAt: doc.deletedAt?.toISOString() ?? null,
      deletedByName: doc.deletedByName,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      tags: doc.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      mine: rights.mine,
      canEdit: rights.canEdit,
      canDownload: rights.canDownload,
      canShare: rights.canShare,
      favorite: favs.has(doc.id),
    } satisfies DocumentDTO;
  });
}

// ── short-lived signed file URLs (no blob caching, hard content-disposition) ─

const FILE_SIGNING_SECRET = process.env.AUTH_SECRET ?? "chms-local-dev-secret";
const FILE_URL_TTL_SECONDS = 300;

function fileSignature(payload: string, exp: number): string {
  return createHmac("sha256", FILE_SIGNING_SECRET).update(`${payload}.${exp}`).digest("hex");
}

/** Signed, 5-minute download URL for one stored version. */
export function signedFileUrl(versionId: string, shareToken?: string): { url: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + FILE_URL_TTL_SECONDS;
  const sig = fileSignature(shareToken ? `${versionId}#${shareToken}` : versionId, exp);
  const params = new URLSearchParams({ exp: String(exp), sig });
  if (shareToken) params.set("share", shareToken);
  return {
    url: `/api/v1/documents/files/${versionId}?${params.toString()}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

function assertValidFileSig(versionId: string, shareToken: string | null, exp: string | null, sig: string | null) {
  const expNum = Number(exp);
  if (!exp || !sig || !Number.isFinite(expNum) || expNum * 1000 < Date.now()) {
    throw new ApiError(403, "link_expired", "This download link has expired. Request a fresh one.");
  }
  const expected = fileSignature(shareToken ? `${versionId}#${shareToken}` : versionId, expNum);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(403, "bad_signature", "Invalid download link signature.");
  }
}

// ═══════════════════════════ LIST + STATS ═════════════════════════════════════

export interface ListParams {
  q?: string; category?: string; access?: string; status?: string; kind?: string;
  owner?: string; tag?: string; folderId?: string; from?: string; to?: string;
  scope?: string; sort?: string; dir?: string; page?: string; pageSize?: string;
  trash?: string; includeInfected?: string;
}

export async function listDocuments(user: SessionUser, params: ListParams): Promise<DocumentsListResp> {
  const settings = await getSettingsRow(user.orgId);
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(48, Math.max(6, Number(params.pageSize) || 12));
  const sortField = params.sort && ["updatedAt", "title", "category", "accessLevel", "byteSize", "currentVersion", "ownerName", "createdAt"].includes(params.sort)
    ? params.sort : "updatedAt";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const trash = params.trash === "1";
  const includeInfected = params.includeInfected === "1" && can(user, "documents.delete");

  const base: Parameters<typeof visibleWhere>[2] = [];
  const q = params.q?.trim();
  if (q) {
    base.push({
      OR: [
        { title: { contains: q } },
        { description: { contains: q } },
        { fileName: { contains: q } },
        { tags: { some: { tag: { name: { contains: q } } } } },
      ],
    });
  }
  if (params.category && (DOCUMENT_CATEGORIES as readonly string[]).includes(params.category)) base.push({ category: params.category });
  if (params.access && (ACCESS_LEVELS_DMS as readonly string[]).includes(params.access)) base.push({ accessLevel: params.access });
  if (params.status && ["draft", "in_review", "approved", "published", "archived"].includes(params.status)) base.push({ status: params.status });
  const kind = params.kind ? kindFilter(params.kind) : null;
  if (kind) base.push(kind);
  if (params.owner) base.push({ ownerId: params.owner });
  if (params.tag) base.push({ tags: { some: { tag: { name: params.tag } } } });
  if (params.folderId === "root") base.push({ folderId: null });
  else if (params.folderId) base.push({ folderId: params.folderId });
  if (params.from && !Number.isNaN(new Date(params.from).getTime())) base.push({ updatedAt: { gte: new Date(params.from) } });
  if (params.to && !Number.isNaN(new Date(params.to).getTime())) {
    const to = new Date(params.to);
    to.setHours(23, 59, 59, 999);
    base.push({ updatedAt: { lte: to } });
  }
  if (params.scope === "mine") base.push({ ownerId: user.membershipId });
  if (params.scope === "favorites") base.push({ favorites: { some: { membershipId: user.membershipId } } });

  const where = await visibleWhere(user, { trash, includeInfected }, base);

  // "recent" scope — newest views first, filtered to visible documents
  if (params.scope === "recent") {
    const views = await db.documentView.findMany({
      where: { orgId: user.orgId, membershipId: user.membershipId },
      orderBy: { viewedAt: "desc" },
      take: 60,
      select: { documentId: true },
    });
    const ids = views.map((v) => v.documentId);
    const rows = await db.document.findMany({
      where: { ...where, id: { in: ids } },
      include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const items = await serializeDocs(user, rows.slice(0, pageSize));
    return { items, total: rows.length, page: 1, pageSize, stats: await computeStats(user, settings.quotaMb), byAccessLevel: await accessCounts(user) };
  }

  const orderBy: Record<string, string> = { [sortField]: dir };
  const [rows, total] = await Promise.all([
    db.document.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true },
    }),
    db.document.count({ where }),
  ]);

  return {
    items: await serializeDocs(user, rows),
    total,
    page,
    pageSize,
    stats: await computeStats(user, settings.quotaMb),
    byAccessLevel: await accessCounts(user),
  };
}

async function accessCounts(user: SessionUser): Promise<Record<string, number>> {
  const where = await visibleWhere(user);
  const rows = await db.document.groupBy({ by: ["accessLevel"], where, _count: true });
  return Object.fromEntries(rows.map((r) => [r.accessLevel, r._count]));
}

async function computeStats(user: SessionUser, quotaMb: number): Promise<DocumentsStats> {
  const live = await visibleWhere(user);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const [total, agg, uploadsThisMonth, pendingReview, expiringSoon, trashCount, infectedCount, draftCount] =
    await Promise.all([
      db.document.count({ where: live }),
      db.document.aggregate({ where: live, _sum: { byteSize: true } }),
      db.document.count({ where: { ...live, createdAt: { gte: monthStart } } }),
      db.document.count({ where: { ...live, status: "in_review" } }),
      db.document.count({ where: { ...live, expiresAt: { gte: new Date(), lte: soon } } }),
      db.document.count({ where: { ...live, deletedAt: { not: null } } }),
      db.document.count({ where: { orgId: user.orgId, scanStatus: "infected" } }),
      db.document.count({ where: { ...live, status: "draft" } }),
    ]);
  return {
    total,
    storageUsedBytes: agg._sum.byteSize ?? 0,
    storageQuotaBytes: quotaMb * 1024 * 1024,
    uploadsThisMonth,
    pendingReview,
    expiringSoon,
    trashCount,
    infectedCount,
    draftCount,
  };
}

// ═══════════════════════════ DETAIL ═══════════════════════════════════════════

export async function getDocument(user: SessionUser, id: string, meta: Meta): Promise<DocumentDetailResp> {
  const { doc, rights } = await loadVisibleDocument(user, id);
  const [versions, shareLinks, comments, views] = await Promise.all([
    db.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: "desc" } }),
    db.shareLink.findMany({ where: { documentId: doc.id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    db.documentComment.findMany({ where: { documentId: doc.id, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.documentView.findMany({ where: { documentId: doc.id }, orderBy: { viewedAt: "desc" }, take: 1 }),
  ]);
  const activity = await db.auditLog.findMany({
    where: { orgId: user.orgId, entityType: "document", entityId: doc.id },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  // record the open — "recently viewed" + counters + audit trail
  await (async () => {
    const existing = await db.documentView.findFirst({
      where: { documentId: doc.id, membershipId: user.membershipId },
      select: { id: true },
    });
    if (existing) {
      await db.documentView.update({ where: { id: existing.id }, data: { viewedAt: new Date() } });
    } else {
      await db.documentView.create({
        data: { orgId: user.orgId, documentId: doc.id, membershipId: user.membershipId },
      });
    }
  })().catch(() => {});
  await Promise.all([
    db.document.update({ where: { id: doc.id }, data: { viewCount: { increment: 1 } } }).catch(() => {}),
    audit({
      orgId: user.orgId, actor: user, action: "document.view",
      entityType: "document", entityId: doc.id, ip: meta.ip, userAgent: meta.userAgent,
    }),
  ]);

  const breadcrumb: { id: string; name: string }[] = [];
  let parentId = doc.folderId;
  let guard = 0;
  while (parentId && guard++ < 10) {
    const folder = await db.folder.findFirst({ where: { id: parentId, orgId: user.orgId }, select: { id: true, name: true, parentId: true } });
    if (!folder) break;
    breadcrumb.unshift({ id: folder.id, name: folder.name });
    parentId = folder.parentId;
  }

  return {
    document: (await serializeDocs(user, [doc]))[0],
    breadcrumb,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      fileName: v.fileName,
      mimeType: v.mimeType,
      byteSize: v.byteSize,
      checksum: v.checksum,
      changelog: v.changelog,
      scanStatus: v.scanStatus,
      uploadedByName: v.uploadedByName,
      createdAt: v.createdAt.toISOString(),
      current: v.version === doc.currentVersion,
      downloadUrl: signedFileUrl(v.id).url,
    })),
    acls: doc.acls.map((a) => ({
      id: a.id, subjectType: a.subjectType, subjectId: a.subjectId, subjectLabel: a.subjectLabel,
      level: a.level, createdByName: a.createdByName, createdAt: a.createdAt.toISOString(),
    })),
    shareLinks: shareLinks.map((l) => serializeShareLink(l)),
    comments: comments.map((c) => ({
      id: c.id, authorId: c.authorId, authorName: c.authorName, body: c.body,
      mentions: jParse<string[]>(c.mentions, []), mine: c.authorId === user.membershipId,
      createdAt: c.createdAt.toISOString(),
    })),
    recentActivity: activity.map((a) => ({
      id: a.id, action: a.action, actorLabel: a.actorLabel, actorType: a.actorType,
      createdAt: a.createdAt.toISOString(), ip: a.ip,
    })),
    perms: {
      canEdit: rights.canEdit,
      canDelete: can(user, "documents.delete"),
      canApprove: can(user, "documents.approve"),
      canShare: rights.canShare,
      canAudit: can(user, "documents.audit"),
      canDownload: rights.canDownload,
      canPreview: rights.canPreview,
    },
  };
}

function serializeShareLink(l: {
  id: string; token: string; passwordHash: string | null; expiresAt: Date | null;
  maxDownloads: number | null; downloadCount: number; revokedAt: Date | null;
  createdByName: string | null; createdAt: Date;
}): ShareLinkDTO {
  return {
    id: l.id,
    token: l.token,
    url: `/shared-document?token=${l.token}`,
    hasPassword: Boolean(l.passwordHash),
    expiresAt: l.expiresAt?.toISOString() ?? null,
    maxDownloads: l.maxDownloads,
    downloadCount: l.downloadCount,
    revokedAt: l.revokedAt?.toISOString() ?? null,
    createdByName: l.createdByName,
    createdAt: l.createdAt.toISOString(),
  };
}

// ═══════════════════════════ SETTINGS ═════════════════════════════════════════

export async function getSettings(user: SessionUser): Promise<DocumentsSettingsDTO> {
  const s = await getSettingsRow(user.orgId);
  return {
    allowedMimes: jParse<string[]>(s.allowedMimes, []),
    maxSizeMb: s.maxSizeMb,
    staffMaxSizeMb: s.staffMaxSizeMb,
    quotaMb: s.quotaMb,
    retentionDays: s.retentionDays,
    defaultAccessLevel: s.defaultAccessLevel,
    requireApproval: s.requireApproval,
    watermarkedByDefault: s.watermarkedByDefault,
    virusScanEnabled: s.virusScanEnabled,
    updatedByName: s.updatedByName,
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

export async function updateSettings(
  user: SessionUser,
  input: {
    allowedMimes?: string[]; maxSizeMb?: number; staffMaxSizeMb?: number; quotaMb?: number;
    retentionDays?: number | null; defaultAccessLevel?: string; requireApproval?: boolean;
    watermarkedByDefault?: boolean; virusScanEnabled?: boolean;
  },
  meta: Meta
): Promise<DocumentsSettingsDTO> {
  if (!can(user, "documents.settings")) throw forbidden('Requires "documents.settings" permission.');
  const current = await getSettingsRow(user.orgId);
  const updated = await db.documentSettings.update({
    where: { orgId: user.orgId },
    data: {
      allowedMimes: input.allowedMimes ? JSON.stringify(input.allowedMimes) : undefined,
      maxSizeMb: input.maxSizeMb,
      staffMaxSizeMb: input.staffMaxSizeMb,
      quotaMb: input.quotaMb,
      retentionDays: input.retentionDays === undefined ? undefined : input.retentionDays,
      defaultAccessLevel: input.defaultAccessLevel,
      requireApproval: input.requireApproval,
      watermarkedByDefault: input.watermarkedByDefault,
      virusScanEnabled: input.virusScanEnabled,
      updatedById: user.membershipId,
      updatedByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "document.settings_update", entityType: "document",
    entityId: "settings", before: { allowedMimes: jParse(current.allowedMimes, []), maxSizeMb: current.maxSizeMb, quotaMb: current.quotaMb },
    after: { allowedMimes: input.allowedMimes, maxSizeMb: input.maxSizeMb, quotaMb: input.quotaMb },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return getSettings(user);
}

// ═══════════════════════════ FOLDERS ══════════════════════════════════════════

export async function listFolders(user: SessionUser): Promise<FolderDTO[]> {
  const rows = await db.folder.findMany({
    where: { orgId: user.orgId, deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
  });
  return rows.map((f) => ({
    id: f.id, name: f.name, parentId: f.parentId, color: f.color,
    documentCount: f._count.documents, createdAt: f.createdAt.toISOString(),
  }));
}

export async function createFolder(user: SessionUser, input: { name: string; parentId?: string; color?: string }, meta: Meta) {
  if (!can(user, "documents.create")) throw forbidden('Requires "documents.create" permission.');
  const name = cleanFileName(input.name ?? "");
  if (!name) throw badRequest("Folder name is required.");
  if (input.parentId) {
    const parent = await db.folder.findFirst({ where: { id: input.parentId, orgId: user.orgId, deletedAt: null } });
    if (!parent) throw notFound("Parent folder not found.");
  }
  const dup = await db.folder.findFirst({ where: { orgId: user.orgId, deletedAt: null, parentId: input.parentId ?? null, name } });
  if (dup) throw conflict(`A folder named "${name}" already exists here.`);
  const folder = await db.folder.create({
    data: {
      orgId: user.orgId, name, parentId: input.parentId ?? null, color: input.color ?? "teal",
      createdById: user.membershipId, createdByName: user.name,
    },
  });
  await audit({ orgId: user.orgId, actor: user, action: "document.folder_create", entityType: "document_folder", entityId: folder.id, after: { name }, ip: meta.ip, userAgent: meta.userAgent });
  return { id: folder.id, name: folder.name, parentId: folder.parentId };
}

export async function renameFolder(user: SessionUser, id: string, input: { name: string }, meta: Meta) {
  if (!can(user, "documents.edit")) throw forbidden('Requires "documents.edit" permission.');
  const folder = await db.folder.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!folder) throw notFound("Folder not found.");
  const name = cleanFileName(input.name ?? "");
  if (!name) throw badRequest("Folder name is required.");
  await db.folder.update({ where: { id }, data: { name } });
  await audit({ orgId: user.orgId, actor: user, action: "document.folder_rename", entityType: "document_folder", entityId: id, before: { name: folder.name }, after: { name }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function deleteFolder(user: SessionUser, id: string, meta: Meta) {
  if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete" permission.');
  const folder = await db.folder.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!folder) throw notFound("Folder not found.");
  const [docCount, childCount] = await Promise.all([
    db.document.count({ where: { folderId: id, deletedAt: null } }),
    db.folder.count({ where: { parentId: id, deletedAt: null } }),
  ]);
  if (docCount > 0 || childCount > 0) {
    throw conflict("Folder is not empty — move or remove its documents and subfolders first.");
  }
  await db.folder.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ orgId: user.orgId, actor: user, action: "document.folder_delete", entityType: "document_folder", entityId: id, before: { name: folder.name }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ═══════════════════════════ UPLOAD PIPELINE ══════════════════════════════════

interface UploadFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

async function validateUpload(user: SessionUser, file: UploadFile) {
  const settings = await getSettingsRow(user.orgId);
  const staff = can(user, "documents.edit");
  const capMb = staff ? settings.staffMaxSizeMb : settings.maxSizeMb;
  if (file.buffer.length === 0) throw badRequest("The file is empty.");
  if (file.buffer.length > capMb * 1024 * 1024) {
    throw badRequest(`File is too large — the limit for you is ${capMb} MB.`);
  }
  const allowed = jParse<string[]>(settings.allowedMimes, []);
  if (!allowed.includes(file.mimeType)) {
    throw badRequest(`File type "${file.mimeType}" is not allowed. Allowed: ${allowed.length} types (see DMS settings).`);
  }
  if (!extMimeConsistent(file.fileName, file.mimeType)) {
    throw badRequest("The file extension does not match its declared type.");
  }
  const verdict = sniff(file.buffer, file.mimeType, file.fileName);
  if (verdict.verdict === "mismatch") throw badRequest(verdict.reason);
  const scanStatus = settings.virusScanEnabled && verdict.verdict === "infected" ? "infected" : "clean";
  return { settings, scanStatus, scanNote: verdict.verdict === "infected" ? verdict.reason : EICAR_SCAN_DISABLED_NOTE };
}

async function assertStorageQuota(orgId: string, extraBytes: number) {
  const settings = await getSettingsRow(orgId);
  const agg = await db.document.aggregate({ where: { orgId, deletedAt: null }, _sum: { byteSize: true } });
  const used = (agg._sum.byteSize ?? 0) + extraBytes;
  if (used > settings.quotaMb * 1024 * 1024) {
    throw new ApiError(413, "quota_exceeded", `Storage quota exceeded (${settings.quotaMb} MB). Free up space in the Trash or raise the quota in DMS settings.`);
  }
}

async function linkTags(orgId: string, documentId: string, tagNames: string[]) {
  for (const raw of tagNames) {
    const name = raw.trim().slice(0, 40);
    if (!name) continue;
    const tag = await db.tag.upsert({ where: { orgId_name: { orgId, name } }, update: {}, create: { orgId, name } });
    await db.documentTag.upsert({
      where: { documentId_tagId: { documentId, tagId: tag.id } },
      update: {},
      create: { documentId, tagId: tag.id },
    });
  }
}

async function syncTags(orgId: string, documentId: string, tagNames: string[]) {
  await db.documentTag.deleteMany({ where: { documentId } });
  await linkTags(orgId, documentId, tagNames);
}

export async function createFromUpload(
  user: SessionUser,
  file: UploadFile,
  metaInput: DocumentMetaInput,
  meta: Meta
): Promise<DocumentDTO> {
  if (!can(user, "documents.create")) throw forbidden('Requires "documents.create" permission.');
  checkRate(`upload:${user.membershipId}`, 30, 60_000);

  const accessLevel = metaInput.accessLevel;
  assertCanSetAccessLevel(user, accessLevel);
  if (metaInput.folderId) {
    const folder = await db.folder.findFirst({ where: { id: metaInput.folderId, orgId: user.orgId, deletedAt: null } });
    if (!folder) throw notFound("Target folder not found.");
  }

  const { settings, scanStatus } = await validateUpload(user, file);
  await assertStorageQuota(user.orgId, file.buffer.length);

  const fileName = cleanFileName(file.fileName);
  const checksum = sha256Hex(file.buffer);

  // duplicate detection — same bytes already live in this tenant
  const dup = await db.document.findFirst({
    where: { orgId: user.orgId, deletedAt: null, checksum },
    select: { id: true, title: true },
  });
  if (dup) {
    throw conflict(`This exact file already exists as "${dup.title}".`, { existingId: dup.id });
  }

  const storageKey = documentStorageKey(user.orgId, extOf(fileName));
  await storage.put(storageKey, file.buffer, file.mimeType);

  const requireApproval = settings.requireApproval;
  const status = requireApproval ? (can(user, "documents.approve") ? "approved" : "draft") : "published";
  const doc = await db.document.create({
    data: {
      orgId: user.orgId,
      title: metaInput.title.trim(),
      description: metaInput.description?.trim() || null,
      category: metaInput.category,
      accessLevel,
      status,
      folderId: metaInput.folderId || null,
      fileName,
      mimeType: file.mimeType,
      byteSize: file.buffer.length,
      checksum,
      storageKey,
      scanStatus,
      ownerId: user.membershipId,
      ownerName: user.name,
      expiresAt: dateOrNull(metaInput.expiresAt),
      reviewAt: dateOrNull(metaInput.reviewAt),
      downloadRestricted: metaInput.downloadRestricted ?? false,
      watermark: metaInput.watermark ?? settings.watermarkedByDefault,
      approvedByName: status === "approved" ? user.name : null,
      approvedAt: status === "approved" ? new Date() : null,
    },
    include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true },
  });
  await db.documentVersion.create({
    data: {
      orgId: user.orgId, documentId: doc.id, version: 1,
      fileName, mimeType: file.mimeType, byteSize: file.buffer.length,
      checksum, storageKey, changelog: "Initial upload", scanStatus,
      uploadedById: user.membershipId, uploadedByName: user.name,
    },
  });
  if (metaInput.tags?.length) await linkTags(user.orgId, doc.id, metaInput.tags);

  await audit({
    orgId: user.orgId, actor: user, action: "document.create", entityType: "document", entityId: doc.id,
    after: { title: doc.title, category: doc.category, accessLevel, bytes: doc.byteSize, status },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  return (await serializeDocs(user, [doc]))[0];
}

export async function addVersionFromUpload(
  user: SessionUser,
  documentId: string,
  file: UploadFile,
  changelog: string | undefined,
  meta: Meta
): Promise<DocumentDTO> {
  const { doc, rights } = await loadVisibleDocument(user, documentId);
  if (!rights.canEdit) throw forbidden("You cannot edit this document.");
  assertNotLocked(doc, user, "upload a new version");
  checkRate(`upload:${user.membershipId}`, 30, 60_000);

  const { scanStatus } = await validateUpload(user, file);
  await assertStorageQuota(user.orgId, file.buffer.length);

  const dup = await db.documentVersion.findFirst({ where: { documentId: doc.id, checksum: sha256Hex(file.buffer) }, select: { version: true } });
  if (dup) throw conflict(`Version ${dup.version} already contains these exact bytes — nothing to upload.`);

  const fileName = cleanFileName(file.fileName);
  const storageKey = documentStorageKey(user.orgId, extOf(fileName));
  await storage.put(storageKey, file.buffer, file.mimeType);

  const nextVersion = doc.currentVersion + 1;
  const [updated] = await db.$transaction([
    db.documentVersion.create({
      data: {
        orgId: user.orgId, documentId: doc.id, version: nextVersion,
        fileName, mimeType: file.mimeType, byteSize: file.buffer.length,
        checksum: sha256Hex(file.buffer), storageKey, changelog: changelog?.trim() || null,
        scanStatus, uploadedById: user.membershipId, uploadedByName: user.name,
      },
    }),
    db.document.update({
      where: { id: doc.id },
      data: {
        currentVersion: nextVersion,
        versionCount: { increment: 1 },
        fileName, mimeType: file.mimeType, byteSize: file.buffer.length,
        checksum: sha256Hex(file.buffer), storageKey, scanStatus,
      },
    }),
  ]);

  await audit({
    orgId: user.orgId, actor: user, action: "document.version_upload", entityType: "document", entityId: doc.id,
    after: { version: nextVersion, bytes: updated.byteSize, changelog: changelog?.trim() || null },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  const fresh = await db.document.findUnique({ where: { id: doc.id }, include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true } });
  return (await serializeDocs(user, [fresh!]))[0];
}

// ═══════════════════════════ METADATA EDIT ════════════════════════════════════

export async function updateDocument(
  user: SessionUser,
  id: string,
  input: Partial<DocumentMetaInput> & { folderId?: string | null },
  meta: Meta
) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  if (!rights.canEdit) throw forbidden("You cannot edit this document.");
  assertNotLocked(doc, user, "edit");
  if (doc.legalHold && !can(user, "documents.delete")) {
    throw forbidden("This document is under legal hold — only administrators can change it.");
  }

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.trim().slice(0, 200);
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.category !== undefined) {
    if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(input.category)) throw badRequest("Unknown category.");
    data.category = input.category;
  }
  if (input.accessLevel !== undefined) {
    assertCanSetAccessLevel(user, input.accessLevel);
    data.accessLevel = input.accessLevel;
  }
  if (input.folderId !== undefined) {
    if (input.folderId) {
      const folder = await db.folder.findFirst({ where: { id: input.folderId, orgId: user.orgId, deletedAt: null } });
      if (!folder) throw notFound("Target folder not found.");
    }
    data.folderId = input.folderId || null;
  }
  if (input.expiresAt !== undefined) data.expiresAt = dateOrNull(input.expiresAt);
  if (input.reviewAt !== undefined) data.reviewAt = dateOrNull(input.reviewAt);
  if (input.downloadRestricted !== undefined) {
    if (!can(user, "documents.delete")) throw forbidden("Only administrators can toggle download restrictions.");
    data.downloadRestricted = input.downloadRestricted;
  }
  if (input.watermark !== undefined) data.watermark = input.watermark;

  const updated = await db.document.update({ where: { id: doc.id }, data, include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true } });
  if (input.tags) await syncTags(user.orgId, doc.id, input.tags);

  await audit({
    orgId: user.orgId, actor: user, action: "document.update", entityType: "document", entityId: doc.id,
    before: { title: doc.title, category: doc.category, accessLevel: doc.accessLevel },
    after: { title: data.title ?? doc.title, category: data.category ?? doc.category, accessLevel: data.accessLevel ?? doc.accessLevel },
    ip: meta.ip, userAgent: meta.userAgent,
  });

  const fresh = await db.document.findUnique({ where: { id: doc.id }, include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true } });
  return (await serializeDocs(user, [fresh!]))[0];
}

// ═══════════════════════════ VERSIONS ═════════════════════════════════════════

export async function listVersions(user: SessionUser, id: string): Promise<DocumentVersionDTO[]> {
  const { doc } = await loadVisibleDocument(user, id);
  const versions = await db.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: "desc" } });
  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    fileName: v.fileName,
    mimeType: v.mimeType,
    byteSize: v.byteSize,
    checksum: v.checksum,
    changelog: v.changelog,
    scanStatus: v.scanStatus,
    uploadedByName: v.uploadedByName,
    createdAt: v.createdAt.toISOString(),
    current: v.version === doc.currentVersion,
    downloadUrl: signedFileUrl(v.id).url,
  }));
}

/** JSON-base64 variant so the version contract works without multipart too. */
export async function addVersionBase64(
  user: SessionUser, id: string,
  input: { fileName?: string; mimeType?: string; dataBase64?: string; changelog?: string },
  meta: Meta
) {
  if (!input.dataBase64) throw badRequest("dataBase64 is required.");
  const m = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(input.dataBase64.trim());
  const buffer = Buffer.from(m ? m[2] : input.dataBase64, "base64");
  const mimeType = (m ? m[1] : input.mimeType) ?? "application/octet-stream";
  const fileName = input.fileName ?? `version-${Date.now()}`;
  return addVersionFromUpload(user, id, { buffer, fileName, mimeType }, input.changelog, meta);
}

export async function restoreVersion(user: SessionUser, id: string, versionId: string, meta: Meta) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  if (!rights.canEdit) throw forbidden("You cannot edit this document.");
  assertNotLocked(doc, user, "restore a version");
  const version = await db.documentVersion.findFirst({ where: { id: versionId, documentId: doc.id } });
  if (!version) throw notFound("Version not found.");
  if (version.version === doc.currentVersion) throw badRequest("That version is already the current one.");

  const buffer = await storage.get(version.storageKey).catch(() => {
    throw conflict("The stored file for that version is no longer available.");
  });
  const nextVersion = doc.currentVersion + 1;
  const storageKey = documentStorageKey(user.orgId, extOf(version.fileName));
  await storage.put(storageKey, buffer, version.mimeType);

  await db.$transaction([
    db.documentVersion.create({
      data: {
        orgId: user.orgId, documentId: doc.id, version: nextVersion,
        fileName: version.fileName, mimeType: version.mimeType, byteSize: version.byteSize,
        checksum: version.checksum, storageKey,
        changelog: `Restored from version ${version.version}`,
        scanStatus: version.scanStatus, uploadedById: user.membershipId, uploadedByName: user.name,
      },
    }),
    db.document.update({
      where: { id: doc.id },
      data: {
        currentVersion: nextVersion, versionCount: { increment: 1 },
        fileName: version.fileName, mimeType: version.mimeType, byteSize: version.byteSize,
        checksum: version.checksum, storageKey, scanStatus: version.scanStatus,
      },
    }),
  ]);

  await audit({
    orgId: user.orgId, actor: user, action: "document.version_restore", entityType: "document", entityId: doc.id,
    after: { restoredFrom: version.version, newVersion: nextVersion }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true, version: nextVersion };
}

// ═══════════════════════════ WORKFLOW ═════════════════════════════════════════

async function notifyOwner(orgId: string, ownerId: string | null, title: string, body: string, entityId: string) {
  if (!ownerId) return;
  const membership = await db.membership.findUnique({ where: { id: ownerId }, select: { userId: true } });
  if (!membership?.userId) return;
  await pushNotifications({ orgId, userIds: [membership.userId], module: "documents", type: "document_workflow", title, body, entityType: "document", entityId, linkModule: "documents" }).catch(() => {});
}

export async function runWorkflow(
  user: SessionUser,
  id: string,
  input: { action: string; note?: string },
  meta: Meta
) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  const action = input.action;
  const approver = can(user, "documents.approve");
  const settings = await getSettingsRow(user.orgId);

  if (action === "submit") {
    if (!rights.canEdit) throw forbidden("You cannot submit this document for review.");
    if (doc.status !== "draft") throw conflict("Only draft documents can be submitted for review.");
    await db.document.update({ where: { id: doc.id }, data: { status: "in_review", workflowNote: input.note?.trim() || null } });
    const approverIds = await userIdsWithPermission(user.orgId, "documents.approve");
    await pushNotifications({
      orgId: user.orgId, userIds: approverIds, module: "documents", type: "document_review",
      title: "Document awaiting review", body: `"${doc.title}" was submitted for approval by ${user.name}.`,
      entityType: "document", entityId: doc.id, linkModule: "documents",
    }).catch(() => {});
  } else if (action === "approve") {
    if (!approver) throw forbidden('Requires "documents.approve" permission.');
    if (doc.status !== "in_review") throw conflict("Only documents in review can be approved.");
    await db.document.update({
      where: { id: doc.id },
      data: { status: "approved", approvedById: user.membershipId, approvedByName: user.name, approvedAt: new Date(), workflowNote: input.note?.trim() || null },
    });
    await notifyOwner(user.orgId, doc.ownerId, "Document approved", `"${doc.title}" was approved by ${user.name}.`, doc.id);
  } else if (action === "reject") {
    if (!approver) throw forbidden('Requires "documents.approve" permission.');
    if (doc.status !== "in_review") throw conflict("Only documents in review can be rejected.");
    await db.document.update({ where: { id: doc.id }, data: { status: "draft", workflowNote: input.note?.trim() || "Rejected without a note." } });
    await notifyOwner(user.orgId, doc.ownerId, "Document sent back", `"${doc.title}" was returned by ${user.name}${input.note ? `: ${input.note}` : "."}`, doc.id);
  } else if (action === "publish") {
    if (!approver) throw forbidden('Requires "documents.approve" permission.');
    const allowedFrom = settings.requireApproval ? ["approved"] : ["approved", "draft", "in_review"];
    if (!allowedFrom.includes(doc.status)) {
      throw conflict(settings.requireApproval ? "Only approved documents can be published." : "This document cannot be published.");
    }
    await db.document.update({
      where: { id: doc.id },
      data: { status: "published", approvedById: doc.approvedById ?? user.membershipId, approvedByName: doc.approvedByName ?? user.name, approvedAt: doc.approvedAt ?? new Date() },
    });
    await notifyOwner(user.orgId, doc.ownerId, "Document published", `"${doc.title}" is now published by ${user.name}.`, doc.id);
  } else if (action === "archive") {
    if (!approver) throw forbidden('Requires "documents.approve" permission.');
    if (doc.status !== "published") throw conflict("Only published documents can be archived.");
    await db.document.update({ where: { id: doc.id }, data: { status: "archived" } });
  } else if (action === "republish") {
    if (!approver) throw forbidden('Requires "documents.approve" permission.');
    if (doc.status !== "archived") throw conflict("Only archived documents can be re-published.");
    await db.document.update({ where: { id: doc.id }, data: { status: "published" } });
  } else {
    throw badRequest("Unknown workflow action.");
  }

  await audit({
    orgId: user.orgId, actor: user, action: `document.${action}`, entityType: "document", entityId: doc.id,
    before: { status: doc.status }, after: { status: action, note: input.note ?? null },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═══════════════════════════ TRASH / LEGAL HOLD ═══════════════════════════════

export async function trashDocument(user: SessionUser, id: string, meta: Meta) {
  if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete" permission.');
  const doc = await db.document.findFirst({ where: { id, orgId: user.orgId, deletedAt: null } });
  if (!doc) throw notFound("Document not found.");
  if (doc.legalHold) throw conflict("This document is under legal hold — release the hold before trashing it.");
  await db.document.update({ where: { id: doc.id }, data: { deletedAt: new Date(), deletedByName: user.name, lockedById: null, lockedByName: null, lockedAt: null } });
  await db.shareLink.updateMany({ where: { documentId: doc.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ orgId: user.orgId, actor: user, action: "document.trash", entityType: "document", entityId: doc.id, before: { title: doc.title }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function restoreDocument(user: SessionUser, id: string, meta: Meta) {
  if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete" permission.');
  const doc = await db.document.findFirst({ where: { id, orgId: user.orgId, deletedAt: { not: null } } });
  if (!doc) throw notFound("Document not found in the Trash.");
  await db.document.update({ where: { id: doc.id }, data: { deletedAt: null, deletedByName: null } });
  await audit({ orgId: user.orgId, actor: user, action: "document.restore", entityType: "document", entityId: doc.id, after: { title: doc.title }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function purgeDocument(user: SessionUser, id: string, meta: Meta) {
  if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete" permission.');
  const doc = await db.document.findFirst({ where: { id, orgId: user.orgId } });
  if (!doc) throw notFound("Document not found.");
  if (doc.legalHold) throw conflict("This document is under legal hold — release the hold before permanent deletion.");
  const versions = await db.documentVersion.findMany({ where: { documentId: doc.id }, select: { storageKey: true } });
  await db.document.delete({ where: { id: doc.id } }); // cascades versions/comments/tags/acls/links/views
  await Promise.all(versions.map((v) => storage.remove(v.storageKey).catch(() => {})));
  await audit({
    orgId: user.orgId, actor: user, actorType: "user", action: "document.purge", entityType: "document", entityId: doc.id,
    before: { title: doc.title, versions: versions.length, bytes: doc.byteSize }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

export async function setLegalHold(user: SessionUser, id: string, value: boolean, meta: Meta) {
  if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete" permission.');
  const doc = await db.document.findFirst({ where: { id, orgId: user.orgId } });
  if (!doc) throw notFound("Document not found.");
  await db.document.update({ where: { id: doc.id }, data: { legalHold: value } });
  await audit({
    orgId: user.orgId, actor: user, action: value ? "document.legal_hold_on" : "document.legal_hold_off",
    entityType: "document", entityId: doc.id, after: { legalHold: value }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═══════════════════════════ CHECK-OUT LOCK ═══════════════════════════════════

export async function lockDocument(user: SessionUser, id: string, meta: Meta) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  if (!rights.canEdit) throw forbidden("You cannot check out this document.");
  assertNotLocked(doc, user, "check out");
  await db.document.update({ where: { id: doc.id }, data: { lockedById: user.membershipId, lockedByName: user.name, lockedAt: new Date() } });
  await audit({ orgId: user.orgId, actor: user, action: "document.checkout", entityType: "document", entityId: doc.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

export async function unlockDocument(user: SessionUser, id: string, meta: Meta) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  const isLocker = doc.lockedById === user.membershipId;
  if (!isLocker && !can(user, "documents.delete")) throw forbidden("Only the user holding the check-out (or an administrator) can release it.");
  await db.document.update({ where: { id: doc.id }, data: { lockedById: null, lockedByName: null, lockedAt: null } });
  await audit({ orgId: user.orgId, actor: user, action: "document.checkin", entityType: "document", entityId: doc.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ═══════════════════════════ FAVORITES ════════════════════════════════════════

export async function toggleFavorite(user: SessionUser, id: string) {
  await loadVisibleDocument(user, id);
  const existing = await db.documentFavorite.findUnique({
    where: { documentId_membershipId: { documentId: id, membershipId: user.membershipId } },
  });
  if (existing) {
    await db.documentFavorite.delete({ where: { documentId_membershipId: { documentId: id, membershipId: user.membershipId } } });
    return { favorite: false };
  }
  await db.documentFavorite.create({ data: { documentId: id, membershipId: user.membershipId } });
  return { favorite: true };
}

// ═══════════════════════════ COMMENTS ═════════════════════════════════════════

export async function listComments(user: SessionUser, id: string): Promise<DocumentCommentDTO[]> {
  const { doc } = await loadVisibleDocument(user, id);
  const rows = await db.documentComment.findMany({ where: { documentId: doc.id, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
  return rows.map((c) => ({
    id: c.id, authorId: c.authorId, authorName: c.authorName, body: c.body,
    mentions: jParse<string[]>(c.mentions, []), mine: c.authorId === user.membershipId,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function addComment(user: SessionUser, id: string, input: { body: string }, meta: Meta) {
  const { doc } = await loadVisibleDocument(user, id);
  const body = input.body.trim();
  if (!body) throw badRequest("Write a comment first.");
  const mentionNames = [...new Set([...body.matchAll(/@([\w .,'-]{2,40})/g)].map((m) => m[1].trim()).filter(Boolean))].slice(0, 10);
  const comment = await db.documentComment.create({
    data: {
      orgId: user.orgId, documentId: doc.id, authorId: user.membershipId,
      authorName: user.name, body: body.slice(0, 2000),
      mentions: mentionNames.length ? JSON.stringify(mentionNames) : null,
    },
  });
  // best-effort @mention notifications
  if (mentionNames.length) {
    try {
      const people = await db.person.findMany({ where: { orgId: user.orgId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
      const targets = people.filter((p) => mentionNames.some((n) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(n.toLowerCase()))).map((p) => p.id).slice(0, 10);
      const { userIdsForPersons } = await import("@/server/services/notifications");
      const userIds = await userIdsForPersons(user.orgId, targets);
      await pushNotifications({
        orgId: user.orgId, userIds: userIds.filter((u) => u !== user.userId), module: "documents", type: "document_mention",
        title: "You were mentioned", body: `${user.name} mentioned you on "${doc.title}".`,
        entityType: "document", entityId: doc.id, linkModule: "documents",
      });
    } catch {
      /* notifications are best-effort */
    }
  }
  await audit({ orgId: user.orgId, actor: user, action: "document.comment", entityType: "document", entityId: doc.id, ip: meta.ip, userAgent: meta.userAgent });
  return { id: comment.id, createdAt: comment.createdAt.toISOString() };
}

export async function deleteComment(user: SessionUser, id: string, commentId: string, meta: Meta) {
  const { doc } = await loadVisibleDocument(user, id);
  const comment = await db.documentComment.findFirst({ where: { id: commentId, documentId: doc.id, deletedAt: null } });
  if (!comment) throw notFound("Comment not found.");
  if (comment.authorId !== user.membershipId && !can(user, "documents.delete")) {
    throw forbidden("Only the author (or an administrator) can remove a comment.");
  }
  await db.documentComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  await audit({ orgId: user.orgId, actor: user, action: "document.comment_delete", entityType: "document", entityId: doc.id, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

// ═══════════════════════════ SHARE LINKS ══════════════════════════════════════

export async function createShareLink(
  user: SessionUser,
  id: string,
  input: { expiresInHours?: number | null; password?: string; maxDownloads?: number | null },
  meta: Meta
) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  if (!rights.canShare) throw forbidden('Requires "documents.share" permission.');
  if (doc.scanStatus === "infected") throw conflict("Quarantined documents cannot be shared.");
  const token = randomBytes(16).toString("hex");
  const link = await db.shareLink.create({
    data: {
      orgId: user.orgId, documentId: doc.id, token,
      passwordHash: input.password ? hashPassword(input.password) : null,
      expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : null,
      maxDownloads: input.maxDownloads ?? null,
      createdById: user.membershipId, createdByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "document.share", entityType: "document", entityId: doc.id,
    after: { linkId: link.id, expiresAt: link.expiresAt?.toISOString() ?? null, hasPassword: Boolean(input.password), maxDownloads: input.maxDownloads ?? null },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return serializeShareLink(link);
}

export async function revokeShareLink(user: SessionUser, id: string, linkId: string, meta: Meta) {
  const { rights } = await loadVisibleDocument(user, id);
  if (!rights.canShare) throw forbidden('Requires "documents.share" permission.');
  const link = await db.shareLink.findFirst({ where: { id: linkId, documentId: id, orgId: user.orgId } });
  if (!link) throw notFound("Share link not found.");
  await db.shareLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
  await audit({ orgId: user.orgId, actor: user, action: "document.share_revoke", entityType: "document", entityId: id, before: { linkId }, ip: meta.ip, userAgent: meta.userAgent });
  return { ok: true };
}

/** PUBLIC — no session. Validates password/expiry/downloads, returns a signed file URL. */
export async function redeemShareLink(token: string, password: string | undefined, ip: string | null, userAgent: string | null) {
  checkRate(`share-redeem:${ip ?? "unknown"}`, 20, 60_000);
  const link = await db.shareLink.findUnique({ where: { token }, include: { document: true } });
  if (!link || link.revokedAt || link.document.deletedAt) throw notFound("This share link is no longer valid.");
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) throw new ApiError(410, "link_expired", "This share link has expired.");
  if (link.maxDownloads != null && link.downloadCount >= link.maxDownloads) {
    throw new ApiError(410, "download_limit", "This share link has reached its download limit.");
  }
  if (link.document.scanStatus === "infected") throw conflict("This document is quarantined and cannot be downloaded.");
  if (link.passwordHash && (!password || !verifyPassword(password, link.passwordHash))) {
    if (password) throw forbidden("Incorrect link password.");
    return { passwordRequired: true as const };
  }

  const version = await db.documentVersion.findFirst({
    where: { documentId: link.documentId, version: link.document.currentVersion },
  });
  if (!version) throw notFound("File not found.");
  const { url, expiresAt } = signedFileUrl(version.id, token);
  await db.shareLink.update({ where: { id: link.id }, data: { downloadCount: { increment: 1 } } });
  await audit({
    orgId: link.orgId, actorType: "system", action: "document.share_redeem",
    entityType: "document", entityId: link.documentId, ip, userAgent,
  });
  return {
    passwordRequired: false as const,
    document: { title: link.document.title, fileName: version.fileName, mimeType: version.mimeType, byteSize: version.byteSize },
    url, expiresAt,
  };
}

// ═══════════════════════════ FILE SERVING ═════════════════════════════════════

export async function serveVersion(
  user: SessionUser | null,
  versionId: string,
  opts: { shareToken?: string | null; exp?: string | null; sig?: string | null; inline?: boolean; ip?: string | null; userAgent?: string | null }
): Promise<Response> {
  const version = await db.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
  if (!version || version.document.orgId !== (user?.orgId ?? version.document.orgId)) throw notFound("File not found.");
  const doc = version.document;
  assertValidFileSig(versionId, opts.shareToken ?? null, opts.exp ?? null, opts.sig ?? null);

  if (opts.shareToken) {
    // share-token path — public, validated against the link
    const link = await db.shareLink.findUnique({ where: { token: opts.shareToken } });
    if (!link || link.revokedAt || link.documentId !== doc.id) throw notFound("This share link is no longer valid.");
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) throw new ApiError(410, "link_expired", "This share link has expired.");
    if (link.maxDownloads != null && link.downloadCount > link.maxDownloads) {
      throw new ApiError(410, "download_limit", "This share link has reached its download limit.");
    }
  } else {
    if (!user) throw new ApiError(401, "unauthorized", "Sign in required.");
    checkRate(`dl:${user.membershipId}`, 60, 60_000);
    const rights = docRights(user, doc, await db.documentAcl.findMany({ where: { documentId: doc.id } }));
    if (rights.denied) throw notFound("File not found.");
    if (!rights.canDownload && !can(user, "documents.delete")) {
      throw forbidden("Downloads are restricted for this document.");
    }
    if (doc.deletedAt) throw notFound("File not found.");
  }
  if (doc.scanStatus === "infected") throw conflict("This document is quarantined — download blocked.");

  const buffer = await storage.get(version.storageKey).catch(() => {
    throw notFound("File content is missing.");
  });

  await Promise.all([
    db.document.update({ where: { id: doc.id }, data: { downloadCount: { increment: 1 } } }).catch(() => {}),
    audit({
      orgId: doc.orgId,
      actor: user ? { membershipId: user.membershipId, name: user.name } : null,
      actorType: user ? "user" : "system",
      action: opts.inline ? "document.preview" : "document.download",
      entityType: "document", entityId: doc.id,
      ip: opts.ip, userAgent: opts.userAgent,
    }),
  ]);

  const safeName = cleanFileName(version.fileName).replace(/"/g, "");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": version.mimeType,
      "content-length": String(buffer.length),
      "content-disposition": `${opts.inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

export async function downloadUrlFor(user: SessionUser, id: string) {
  const { doc, rights } = await loadVisibleDocument(user, id);
  if (!rights.canDownload && !can(user, "documents.delete")) throw forbidden("Downloads are restricted for this document.");
  if (doc.scanStatus === "infected") throw conflict("This document is quarantined — download blocked.");
  const version = await db.documentVersion.findFirst({ where: { documentId: doc.id, version: doc.currentVersion } });
  if (!version) throw notFound("File not found.");
  return signedFileUrl(version.id);
}

// ═══════════════════════════ BULK ═════════════════════════════════════════════

export async function bulkOperation(
  user: SessionUser,
  input: { ids: string[]; action: string; category?: string; accessLevel?: string; folderId?: string | null; tags?: string[] },
  meta: Meta
) {
  const results: { updated: string[]; skipped: { id: string; reason: string }[] } = { updated: [], skipped: [] };
  for (const id of input.ids.slice(0, 200)) {
    try {
      // admin-tier ops (restore/purge) read regardless of trash state, but the
      // per-user ACL deny still hides the record entirely
      const adminOp = input.action === "restore" || input.action === "purge";
      let doc;
      let rights;
      if (adminOp) {
        doc = await db.document.findFirst({
          where: {
            id, orgId: user.orgId,
            deletedAt: input.action === "restore" ? { not: null } : undefined,
          },
          include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true },
        });
        if (!doc) throw notFound("Document not found.");
        rights = docRights(user, doc, doc.acls);
        if (rights.denied) throw notFound("Document not found.");
      } else {
        ({ doc, rights } = await loadVisibleDocument(user, id));
      }
      switch (input.action) {
        case "setCategory":
          if (!rights.canEdit) throw forbidden("Cannot edit this document.");
          await db.document.update({ where: { id }, data: { category: input.category ?? doc.category } });
          break;
        case "setAccess":
          if (!rights.canEdit) throw forbidden("Cannot edit this document.");
          assertCanSetAccessLevel(user, input.accessLevel ?? doc.accessLevel);
          await db.document.update({ where: { id }, data: { accessLevel: input.accessLevel ?? doc.accessLevel } });
          break;
        case "moveToFolder":
          if (!rights.canEdit) throw forbidden("Cannot edit this document.");
          await db.document.update({ where: { id }, data: { folderId: input.folderId || null } });
          break;
        case "addTags":
          if (!rights.canEdit) throw forbidden("Cannot edit this document.");
          await linkTags(user.orgId, id, input.tags ?? []);
          break;
        case "archive":
          if (!can(user, "documents.approve")) throw forbidden('Requires "documents.approve".');
          await db.document.update({ where: { id }, data: { status: "archived" } });
          break;
        case "trash":
          if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete".');
          if (doc.legalHold) throw conflict("Legal hold");
          await db.document.update({ where: { id }, data: { deletedAt: new Date(), deletedByName: user.name } });
          await db.shareLink.updateMany({ where: { documentId: id, revokedAt: null }, data: { revokedAt: new Date() } });
          break;
        case "restore":
          if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete".');
          await db.document.update({ where: { id }, data: { deletedAt: null, deletedByName: null } });
          break;
        case "purge": {
          if (!can(user, "documents.delete")) throw forbidden('Requires "documents.delete".');
          if (doc.legalHold) throw conflict("Legal hold");
          const versions = await db.documentVersion.findMany({ where: { documentId: id }, select: { storageKey: true } });
          await db.document.delete({ where: { id } });
          await Promise.all(versions.map((v) => storage.remove(v.storageKey).catch(() => {})));
          break;
        }
        default:
          throw badRequest("Unknown bulk action.");
      }
      results.updated.push(id);
    } catch (err) {
      results.skipped.push({ id, reason: err instanceof ApiError ? err.message : "Failed." });
    }
  }
  await audit({
    orgId: user.orgId, actor: user, action: `document.bulk_${input.action}`, entityType: "document",
    entityId: results.updated[0] ?? null, after: { count: results.updated.length, skipped: results.skipped.length },
    ip: meta.ip, userAgent: meta.userAgent,
  });
  return results;
}

// ═══════════════════════════ ACL OVERRIDES ═══════════════════════════════════

export async function addAcl(
  user: SessionUser,
  id: string,
  input: { subjectType: string; subjectId: string; subjectLabel: string; level: string },
  meta: Meta
) {
  const { rights } = await loadVisibleDocument(user, id);
  if (!rights.canShare) throw forbidden('Requires "documents.share" permission.');
  const level = ["read", "edit", "manage", "deny"].includes(input.level) ? input.level : null;
  const subjectType = ["user", "role", "department"].includes(input.subjectType) ? input.subjectType : null;
  if (!level || !subjectType) throw badRequest("Invalid override subject or level.");
  if (!input.subjectId?.trim()) throw badRequest("Pick a subject for the override.");
  const acl = await db.documentAcl.create({
    data: {
      orgId: user.orgId, documentId: id,
      subjectType, subjectId: input.subjectId.trim(), subjectLabel: input.subjectLabel.trim().slice(0, 120) || input.subjectId,
      level,
      createdByName: user.name,
    },
  });
  await audit({
    orgId: user.orgId, actor: user, action: "document.acl_add", entityType: "document", entityId: id,
    after: { aclId: acl.id, subjectType, subjectId: input.subjectId, level }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id: acl.id };
}

export async function removeAcl(user: SessionUser, id: string, aclId: string, meta: Meta) {
  const { rights } = await loadVisibleDocument(user, id);
  if (!rights.canShare) throw forbidden('Requires "documents.share" permission.');
  const acl = await db.documentAcl.findFirst({ where: { id: aclId, documentId: id, orgId: user.orgId } });
  if (!acl) throw notFound("Access override not found.");
  await db.documentAcl.delete({ where: { id: aclId } });
  await audit({
    orgId: user.orgId, actor: user, action: "document.acl_remove", entityType: "document", entityId: id,
    before: { subjectType: acl.subjectType, subjectId: acl.subjectId, level: acl.level }, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { ok: true };
}

// ═══════════════════════════ AUDIT + EXPORTS ══════════════════════════════════

export async function documentAudit(user: SessionUser, id: string) {
  if (!can(user, "documents.audit")) throw forbidden('Requires "documents.audit" permission.');
  const { doc } = await loadVisibleDocument(user, id);
  const rows = await db.auditLog.findMany({
    where: { orgId: user.orgId, entityType: "document", entityId: doc.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((a) => ({
    id: a.id, action: a.action, actorLabel: a.actorLabel, actorType: a.actorType,
    createdAt: a.createdAt.toISOString(), ip: a.ip, userAgent: a.userAgent,
  }));
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(filename: string, rows: (string | number | null)[][]): Response {
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function exportInventoryCsv(user: SessionUser): Promise<Response> {
  if (!can(user, "documents.audit")) throw forbidden('Requires "documents.audit" permission.');
  const where = await visibleWhere(user, {}, [{ deletedAt: null }]);
  const docs = await db.document.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 5000,
    include: { tags: { include: { tag: true } }, folder: { select: { name: true } } },
  });
  const rows: (string | number | null)[][] = [
    ["Title", "Category", "Access", "Status", "Folder", "Owner", "Version", "File", "Type", "Size (bytes)", "Scan", "Views", "Downloads", "Expires", "Review", "Tags", "Created", "Updated"],
    ...docs.map((d) => [
      d.title, d.category, d.accessLevel, d.status, d.folder?.name ?? "", d.ownerName ?? "",
      d.currentVersion, d.fileName, d.mimeType, d.byteSize, d.scanStatus, d.viewCount, d.downloadCount,
      d.expiresAt?.toISOString() ?? "", d.reviewAt?.toISOString() ?? "",
      d.tags.map((t) => t.tag.name).join("|"), d.createdAt.toISOString(), d.updatedAt.toISOString(),
    ]),
  ];
  return csvResponse("document-inventory.csv", rows);
}

export async function exportAuditCsv(user: SessionUser, id?: string): Promise<Response> {
  if (!can(user, "documents.audit")) throw forbidden('Requires "documents.audit" permission.');
  const rows = await db.auditLog.findMany({
    where: { orgId: user.orgId, entityType: "document", ...(id ? { entityId: id } : {}) },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  return csvResponse("document-audit.csv", [
    ["Timestamp", "Action", "Actor", "Actor type", "Entity", "IP", "User agent"],
    ...rows.map((a) => [a.createdAt.toISOString(), a.action, a.actorLabel ?? "", a.actorType, a.entityId ?? "", a.ip ?? "", a.userAgent ?? ""]),
  ]);
}

// ═══════════════════════════ LOOKUPS ══════════════════════════════════════════

export async function listEligibleUsers(user: SessionUser) {
  const memberships = await db.membership.findMany({
    where: { orgId: user.orgId, status: "active" },
    take: 500,
    include: {
      user: { select: { name: true } },
      roleAssignments: { include: { role: { select: { name: true } } } },
    },
    orderBy: { joinedAt: "asc" },
  });
  return memberships
    .filter((m) => m.user)
    .map((m) => ({
      membershipId: m.id,
      name: m.user?.name ?? "—",
      roleNames: m.roleAssignments.map((ra) => ra.role.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDocumentTags(user: SessionUser) {
  const rows = await db.tag.findMany({
    where: { orgId: user.orgId, documents: { some: {} } },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows;
}

/** Trash list — visibleWhere with deletedAt non-null. */
export async function listTrash(user: SessionUser, params: { q?: string; page?: string; pageSize?: string }) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(48, Math.max(6, Number(params.pageSize) || 24));
  const base: Parameters<typeof visibleWhere>[2] = [];
  if (params.q?.trim()) base.push({ title: { contains: params.q.trim() } });
  const where = await visibleWhere(user, { trash: true }, base);
  const [rows, total] = await Promise.all([
    db.document.findMany({
      where, orderBy: { deletedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      include: { tags: { include: { tag: true } }, folder: { select: { name: true } }, acls: true },
    }),
    db.document.count({ where }),
  ]);
  return { items: await serializeDocs(user, rows), total, page, pageSize };
}
