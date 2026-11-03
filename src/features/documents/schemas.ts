/**
 * Documents (DMS) zod schemas — shared by the API routes/services (server-side
 * validation) and the client forms (react-hook-form resolvers). zod v4.
 */
import { z } from "zod";
import {
  ACCESS_LEVELS_DMS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  SORT_FIELDS,
  ACL_LEVELS,
  ACL_SUBJECT_TYPES,
} from "./constants";

// ── metadata (create + edit) ────────────────────────────────────────────────

export const documentMetaSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long (max 200)."),
  description: z.string().trim().max(2000, "Description is too long (max 2000).").optional().or(z.literal("")),
  category: z.enum(DOCUMENT_CATEGORIES, { message: "Pick a valid category." }),
  accessLevel: z.enum(ACCESS_LEVELS_DMS, { message: "Pick a valid access level." }),
  folderId: z.string().trim().max(64).optional().or(z.literal("")),
  tags: z.array(z.string().trim().min(1).max(40)).max(20, "Up to 20 tags.").optional(),
  /** ISO / datetime-local strings — parsed server-side */
  expiresAt: z.string().trim().max(40).optional().or(z.literal("")),
  reviewAt: z.string().trim().max(40).optional().or(z.literal("")),
  downloadRestricted: z.boolean().optional(),
  watermark: z.boolean().optional(),
});
export type DocumentMetaInput = z.infer<typeof documentMetaSchema>;

export const versionUploadSchema = z.object({
  changelog: z.string().trim().max(500, "Changelog note is too long (max 500).").optional().or(z.literal("")),
});
export type VersionUploadInput = z.infer<typeof versionUploadSchema>;

// ── share links ─────────────────────────────────────────────────────────────

export const shareLinkSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).optional().nullable(),
  password: z.string().trim().min(4, "Password must be at least 4 characters.").max(72).optional().or(z.literal("")),
  maxDownloads: z.coerce.number().int().min(1).max(10_000).optional().nullable(),
});
export type ShareLinkInput = z.infer<typeof shareLinkSchema>;

// ── ACL ─────────────────────────────────────────────────────────────────────

export const aclSchema = z.object({
  subjectType: z.enum(ACL_SUBJECT_TYPES),
  subjectId: z.string().trim().min(1, "Pick a subject."),
  subjectLabel: z.string().trim().min(1).max(120),
  level: z.enum(ACL_LEVELS),
});
export type AclInput = z.infer<typeof aclSchema>;

// ── comments ────────────────────────────────────────────────────────────────

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Write a comment first.").max(2000, "Comment is too long (max 2000)."),
});
export type CommentInput = z.infer<typeof commentSchema>;

// ── workflow ────────────────────────────────────────────────────────────────

export const workflowSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "publish", "archive", "republish"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

// ── bulk ────────────────────────────────────────────────────────────────────

export const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one document.").max(200),
  action: z.enum(["setCategory", "setAccess", "moveToFolder", "addTags", "archive", "trash", "restore", "purge"]),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  accessLevel: z.enum(ACCESS_LEVELS_DMS).optional(),
  folderId: z.string().trim().max(64).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type BulkInput = z.infer<typeof bulkSchema>;

// ── admin settings ──────────────────────────────────────────────────────────

export const settingsSchema = z.object({
  allowedMimes: z.array(z.string().trim().min(3).max(120)).min(1, "Allow at least one file type."),
  maxSizeMb: z.coerce.number().int().min(1).max(1024),
  staffMaxSizeMb: z.coerce.number().int().min(1).max(4096),
  quotaMb: z.coerce.number().int().min(64).max(1_048_576),
  retentionDays: z.coerce.number().int().min(30).max(3650).optional().nullable(),
  defaultAccessLevel: z.enum(ACCESS_LEVELS_DMS),
  requireApproval: z.boolean(),
  watermarkedByDefault: z.boolean(),
  virusScanEnabled: z.boolean(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

// ── list filters (parsed from URL by useDocumentFilters) ────────────────────
// The UI's "All" sentinel never reaches the server: the hook maps ALL ⇄ "".

export const filtersSchema = z.object({
  q: z.string().max(120).default(""),
  category: z.enum(DOCUMENT_CATEGORIES).or(z.literal("")).default(""),
  access: z.enum(ACCESS_LEVELS_DMS).or(z.literal("")).default(""),
  status: z.enum(DOCUMENT_STATUSES).or(z.literal("")).default(""),
  kind: z.string().max(20).default(""), // FileKind
  owner: z.string().max(64).default(""),
  tag: z.string().max(40).default(""),
  folderId: z.string().max(64).default(""),
  from: z.string().max(20).default(""),
  to: z.string().max(20).default(""),
  scope: z.enum(["", "mine", "recent", "favorites"]).default(""),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((v) => [12, 24, 48].includes(v), "Invalid page size.").default(12),
});
export type DocumentFilters = z.infer<typeof filtersSchema>;

// ── folders ─────────────────────────────────────────────────────────────────

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required.").max(80, "Folder name is too long.").regex(/^[^/\\]+$/, "Folder name cannot contain slashes."),
  parentId: z.string().trim().max(64).optional().or(z.literal("")),
  color: z.string().trim().max(20).optional(),
});
export type FolderInput = z.infer<typeof folderSchema>;
