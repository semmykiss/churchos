/**
 * Documents (DMS) DTOs — mirrors the JSON shapes returned by
 * /api/v1/documents*. Frontend only; kept in sync by the serializers in
 * src/server/services/documents/index.ts.
 */
import type {
  DocumentAccessLevel,
  DocumentCategory,
  DocumentStatus,
  ScanStatus,
  FileKind,
  DocumentAclLevel,
  DocumentAclSubjectType,
} from "./constants";

export interface DocumentTagDTO {
  id: string;
  name: string;
  color: string;
}

export interface DocumentDTO {
  id: string;
  title: string;
  description: string | null;
  category: DocumentCategory | string;
  accessLevel: DocumentAccessLevel | string;
  status: DocumentStatus | string;
  folderId: string | null;
  folderName: string | null;
  currentVersion: number;
  versionCount: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  fileKind: FileKind;
  scanStatus: ScanStatus | string;
  ownerId: string | null;
  ownerName: string | null;
  expiresAt: string | null;
  reviewAt: string | null;
  legalHold: boolean;
  downloadRestricted: boolean;
  watermark: boolean;
  lockedById: string | null;
  lockedByName: string | null;
  lockedAt: string | null;
  viewCount: number;
  downloadCount: number;
  approvedByName: string | null;
  approvedAt: string | null;
  workflowNote: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
  createdAt: string;
  updatedAt: string;
  tags: DocumentTagDTO[];
  /** viewer-relative rights (server-computed — the UI NEVER decides these) */
  mine: boolean;
  canEdit: boolean;
  canDownload: boolean;
  canShare: boolean;
  favorite: boolean;
}

export interface DocumentsStats {
  total: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  uploadsThisMonth: number;
  pendingReview: number;
  expiringSoon: number;
  trashCount: number;
  infectedCount: number;
  draftCount: number;
}

export interface DocumentsListResp {
  items: DocumentDTO[];
  total: number;
  page: number;
  pageSize: number;
  stats: DocumentsStats;
  /** access-level matrix counts (drives the derived filter help chips) */
  byAccessLevel: Record<string, number>;
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  documentCount: number;
  createdAt: string;
}

export interface DocumentVersionDTO {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  changelog: string | null;
  scanStatus: ScanStatus | string;
  uploadedByName: string | null;
  createdAt: string;
  current: boolean;
  downloadUrl?: string | null;
}

export interface DocumentAclDTO {
  id: string;
  subjectType: DocumentAclSubjectType | string;
  subjectId: string;
  subjectLabel: string;
  level: DocumentAclLevel | string;
  createdByName: string | null;
  createdAt: string;
}

export interface ShareLinkDTO {
  id: string;
  token: string;
  url: string;
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  revokedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface DocumentCommentDTO {
  id: string;
  authorName: string;
  authorId: string | null;
  body: string;
  mentions: string[];
  mine: boolean;
  createdAt: string;
}

export interface DocumentActivityDTO {
  id: string;
  action: string;
  actorLabel: string | null;
  actorType: string;
  createdAt: string;
  ip: string | null;
}

export interface DocumentDetailResp {
  document: DocumentDTO;
  breadcrumb: { id: string; name: string }[];
  versions: DocumentVersionDTO[];
  acls: DocumentAclDTO[];
  shareLinks: ShareLinkDTO[];
  comments: DocumentCommentDTO[];
  recentActivity: DocumentActivityDTO[];
  /** permission bits for the current viewer (server-computed) */
  perms: {
    canEdit: boolean;
    canDelete: boolean;
    canApprove: boolean;
    canShare: boolean;
    canAudit: boolean;
    canDownload: boolean;
    canPreview: boolean;
  };
}

export interface DocumentsSettingsDTO {
  allowedMimes: string[];
  maxSizeMb: number;
  staffMaxSizeMb: number;
  quotaMb: number;
  retentionDays: number | null;
  defaultAccessLevel: DocumentAccessLevel | string;
  requireApproval: boolean;
  watermarkedByDefault: boolean;
  virusScanEnabled: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface DocumentLookupUser {
  membershipId: string;
  name: string;
  roleNames: string[];
}

/** Pending file in the upload queue (client-side only). */
export interface UploadQueueItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error" | "canceled" | "paused";
  progress: number; // 0..100
  error?: string;
  result?: DocumentDTO;
}
