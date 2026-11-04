/**
 * Documents (DMS) shared constants — imported by BOTH the server services and
 * the client feature components. Pure TypeScript: no react, no node, no zod.
 *
 * The access-level help text in the UI is DERIVED from ACCESS_LEVEL_META (and
 * the server enforces the exact same ranks from src/server/services/documents/
 * access.ts) — there is no hardcoded "who can see this" copy anywhere.
 */

// ── Categories ───────────────────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES = ["policy", "template", "minutes", "form", "report", "resource"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  policy: "Policy",
  template: "Template",
  minutes: "Minutes",
  form: "Form",
  report: "Report",
  resource: "Resource",
};

// ── Access levels (coarse, per-document) ─────────────────────────────────────

export const ACCESS_LEVELS_DMS = ["public", "members", "staff", "leaders", "finance", "pastoral"] as const;
export type DocumentAccessLevel = (typeof ACCESS_LEVELS_DMS)[number];

/**
 * Viewer rank the SERVER computes per session (mirrored in
 * src/server/services/documents/access.ts — keep in sync):
 *   0 public/members · 1 staff · 2 leaders · 3 finance · 4 pastoral.
 * UI help text is generated from these descriptions.
 */
export const ACCESS_LEVEL_META: Record<
  DocumentAccessLevel,
  { rank: number; label: string; description: string }
> = {
  public: { rank: 0, label: "Public", description: "Everyone in the church — including portal members" },
  members: { rank: 0, label: "Members", description: "Everyone signed in to the church app" },
  staff: { rank: 1, label: "Staff", description: "Church office staff and team leads with edit rights" },
  leaders: { rank: 2, label: "Leaders", description: "Pastors, ministers and HODs (approver-level roles)" },
  finance: { rank: 3, label: "Finance", description: "Accountant, treasurer and church admin only" },
  pastoral: { rank: 4, label: "Pastoral", description: "Senior pastoral team and church admin only" },
};

export const ACCESS_RANK_ALLOWED: Record<number, DocumentAccessLevel[]> = {
  0: ["public", "members"],
  1: ["public", "members", "staff"],
  2: ["public", "members", "staff", "leaders"],
  3: ["public", "members", "staff", "leaders", "finance"],
  4: ["public", "members", "staff", "leaders", "finance", "pastoral"],
};

// ── Status workflow: draft → in_review → approved → published → archived ─────

export const DOCUMENT_STATUSES = ["draft", "in_review", "approved", "published", "archived"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const STATUS_META: Record<DocumentStatus, { label: string; tone: "muted" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "muted" },
  in_review: { label: "In review", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "muted" },
};

/** Legal transitions — mirrored by the service; used by the UI to show buttons. */
export const STATUS_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  draft: ["in_review"],
  in_review: ["draft", "approved"],
  approved: ["published"],
  published: ["archived"],
  archived: ["published"],
};

// ── Virus/malware scan pipeline ──────────────────────────────────────────────

export const SCAN_STATUSES = ["pending", "clean", "infected"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SCAN_META: Record<ScanStatus, { label: string; tone: "muted" | "success" | "danger" }> = {
  pending: { label: "Scan pending", tone: "muted" },
  clean: { label: "Scan clean", tone: "success" },
  infected: { label: "Quarantined", tone: "danger" },
};

// ── File type groups (filter + badges) ───────────────────────────────────────

export const FILE_KINDS = ["pdf", "image", "word", "excel", "powerpoint", "text", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  pdf: "PDF", image: "Image", word: "Word", excel: "Excel", powerpoint: "PowerPoint", text: "Text / CSV", other: "Other",
};

export function fileKindFromMime(mime: string): FileKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("word") || mime.includes("document")) return "word";
  if (mime.includes("excel") || mime.includes("spreadsheet") || mime === "text/csv") return "excel";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "powerpoint";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

// ── Sorting / paging ─────────────────────────────────────────────────────────

export const SORT_FIELDS = ["updatedAt", "title", "category", "accessLevel", "byteSize", "currentVersion", "ownerName", "createdAt"] as const;
export type DocumentSortField = (typeof SORT_FIELDS)[number];

export const SORT_FIELD_LABELS: Record<DocumentSortField, string> = {
  updatedAt: "Last updated",
  title: "Title",
  category: "Category",
  accessLevel: "Access",
  byteSize: "Size",
  currentVersion: "Version",
  ownerName: "Owner",
  createdAt: "Uploaded",
};

export const PAGE_SIZES = [12, 24, 48] as const;

/** "All" sentinel — Select items use this value; the URL-state hook maps it to "". */
export const ALL = "all";

export const VIEW_STORAGE_KEY = "chms.documents.view";
export type DocumentsViewMode = "grid" | "table";

// ── ACL ──────────────────────────────────────────────────────────────────────

export const ACL_LEVELS = ["read", "edit", "manage", "deny"] as const;
export type DocumentAclLevel = (typeof ACL_LEVELS)[number];

export const ACL_SUBJECT_TYPES = ["user", "role", "department"] as const;
export type DocumentAclSubjectType = (typeof ACL_SUBJECT_TYPES)[number];

export const ACL_LEVEL_LABELS: Record<DocumentAclLevel, string> = {
  read: "Can view", edit: "Can edit", manage: "Full control", deny: "Blocked",
};

// ── i18n-ready strings (single source for the module's copy) ────────────────

export const STRINGS = {
  moduleTitle: "Documents",
  moduleDescription: "Church document library — policies, templates, minutes and resources with versioning, approvals and secure sharing.",
  upload: "Upload",
  uploadNewVersion: "Upload new version",
  searchPlaceholder: "Search title, description, tags or filename…",
  filters: "Filters",
  clearFilters: "Clear filters",
  gridView: "Grid view",
  tableView: "Table view",
  myUploads: "My uploads",
  recentlyViewed: "Recently viewed",
  favorites: "Favorites",
  trash: "Trash",
  settings: "DMS settings",
  share: "Share",
  download: "Download",
  preview: "Preview",
  versions: "Versions",
  activity: "Activity",
  comments: "Comments",
  overview: "Overview",
  restore: "Restore",
  deleteForever: "Delete forever",
  empty: "No documents yet",
  emptyHint: "Upload your first policy, template or minutes document to get started.",
  noResults: "No documents match your filters",
  noResultsHint: "Try a different search term or clear some filters.",
  offline: "You appear to be offline — showing the last loaded page.",
  requestAccess: "Request access",
  confirmOpen: "This document is restricted. Open it?",
} as const;
