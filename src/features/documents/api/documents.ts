/**
 * Documents typed API client (frontend only) — every server call the module
 * makes goes through here so error handling, retry rules and types stay in
 * one place. 401/403 surface as ApiError; network errors retry twice with a
 * short backoff for idempotent GETs.
 */
import { api, ApiError, qs } from "@/lib/api";
import type {
  DocumentDTO,
  DocumentsListResp,
  DocumentDetailResp,
  DocumentVersionDTO,
  DocumentCommentDTO,
  DocumentsSettingsDTO,
  FolderDTO,
  DocumentLookupUser,
} from "../types";
import type { DocumentFilters } from "../schemas";

// ── query key factory ───────────────────────────────────────────────────────

export const docKeys = {
  all: () => ["documents"] as const,
  list: (filters: DocumentFilters, trash: boolean) => [...docKeys.all(), "list", trash ? "trash" : "live", filters] as const,
  detail: (id: string | null) => [...docKeys.all(), "detail", id ?? "none"] as const,
  versions: (id: string | null) => [...docKeys.all(), "versions", id ?? "none"] as const,
  comments: (id: string | null) => [...docKeys.all(), "comments", id ?? "none"] as const,
  folders: () => [...docKeys.all(), "folders"] as const,
  settings: () => [...docKeys.all(), "settings"] as const,
  lookups: () => [...docKeys.all(), "lookups"] as const,
};

// ── retry rule: idempotent GETs retry on network/5s errors ──────────────────

export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
      if (!retryable || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ── filters → query string (URL state is the single source of truth) ─────────

export function filtersToQuery(f: DocumentFilters, extra: Record<string, string | undefined> = {}): string {
  return qs({
    q: f.q || undefined,
    category: f.category || undefined,
    access: f.access || undefined,
    status: f.status || undefined,
    kind: f.kind || undefined,
    owner: f.owner || undefined,
    tag: f.tag || undefined,
    folderId: f.folderId || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    scope: f.scope || undefined,
    sort: f.sort,
    dir: f.dir,
    page: f.page > 1 ? f.page : undefined,
    pageSize: f.pageSize !== 12 ? f.pageSize : undefined,
    ...extra,
  });
}

// ── reads ───────────────────────────────────────────────────────────────────

export function fetchDocuments(filters: DocumentFilters, opts: { trash?: boolean; includeInfected?: boolean } = {}) {
  const extra = opts.trash ? { trash: "1" } : opts.includeInfected ? { includeInfected: "1" } : {};
  return withRetry(() => api.get<DocumentsListResp>(`/documents${filtersToQuery(filters, extra)}`));
}

export function fetchDocument(id: string) {
  return withRetry(() => api.get<DocumentDetailResp>(`/documents/${id}`));
}

export function fetchFolders() {
  return withRetry(() => api.get<FolderDTO[]>(`/documents/folders`));
}

export function fetchVersions(id: string) {
  return withRetry(() => api.get<DocumentVersionDTO[]>(`/documents/${id}/versions`));
}

export function fetchComments(id: string) {
  return withRetry(() => api.get<DocumentCommentDTO[]>(`/documents/${id}/comments`));
}

export function fetchSettings() {
  return withRetry(() => api.get<DocumentsSettingsDTO>(`/documents/settings`));
}

export function fetchLookupUsers() {
  return withRetry(() => api.get<DocumentLookupUser[]>(`/documents/lookup/users`));
}

export function fetchLookupTags() {
  return withRetry(() => api.get<{ id: string; name: string; color: string }[]>(`/documents/lookup/tags`));
}

// ── writes ──────────────────────────────────────────────────────────────────

export function updateDocument(id: string, body: Record<string, unknown>) {
  return api.patch<DocumentDTO>(`/documents/${id}`, body);
}

export function trashDocument(id: string) {
  return api.del<{ ok: boolean }>(`/documents/${id}`);
}

export function restoreDocument(id: string) {
  return api.post<{ ok: boolean }>(`/documents/${id}/restore`);
}

export function purgeDocument(id: string) {
  return api.del<{ ok: boolean }>(`/documents/${id}/purge`);
}

export function setLegalHold(id: string, value: boolean) {
  return api.post<{ ok: boolean }>(`/documents/${id}/legal-hold`, { value });
}

export function lockDocument(id: string) {
  return api.post<{ ok: boolean }>(`/documents/${id}/lock`);
}

export function unlockDocument(id: string) {
  return api.post<{ ok: boolean }>(`/documents/${id}/unlock`);
}

export function toggleFavorite(id: string) {
  return api.post<{ favorite: boolean }>(`/documents/${id}/favorite`);
}

export function runWorkflow(id: string, action: string, note?: string) {
  return api.post<{ ok: boolean }>(`/documents/${id}/workflow`, { action, note });
}

export function restoreVersion(id: string, versionId: string) {
  return api.post<{ ok: boolean; version: number }>(`/documents/${id}/versions/${versionId}/restore`);
}

export function addComment(id: string, body: string) {
  return api.post<{ id: string }>(`/documents/${id}/comments`, { body });
}

export function deleteComment(id: string, commentId: string) {
  return api.del<{ ok: boolean }>(`/documents/${id}/comments/${commentId}`);
}

export function createShareLink(id: string, body: { expiresInHours?: number | null; password?: string; maxDownloads?: number | null }) {
  return api.post<import("../types").ShareLinkDTO>(`/documents/${id}/share`, body);
}

export function revokeShareLink(id: string, linkId: string) {
  return api.post<{ ok: boolean }>(`/documents/${id}/share/${linkId}/revoke`);
}

export function createFolder(body: { name: string; parentId?: string; color?: string }) {
  return api.post<{ id: string; name: string }>(`/documents/folders`, body);
}

export function renameFolder(id: string, name: string) {
  return api.patch<{ ok: boolean }>(`/documents/folders/${id}`, { name });
}

export function deleteFolder(id: string) {
  return api.del<{ ok: boolean }>(`/documents/folders/${id}`);
}

export function bulkOperation(body: {
  ids: string[];
  action: string;
  category?: string;
  accessLevel?: string;
  folderId?: string | null;
  tags?: string[];
}) {
  return api.post<{ updated: string[]; skipped: { id: string; reason: string }[] }>(`/documents/bulk`, body);
}

export function saveSettings(body: Record<string, unknown>) {
  return api.put<DocumentsSettingsDTO>(`/documents/settings`, body);
}

/** Ask the server for a short-lived signed download URL. */
export async function getSignedUrl(id: string): Promise<{ url: string; expiresAt: string }> {
  return api.get<{ url: string; expiresAt: string }>(`/documents/${id}/download-url`);
}

/** Ask for the signed URL, then open it in a new tab. */
export async function openSignedDownload(id: string): Promise<void> {
  const { url } = await getSignedUrl(id);
  window.open(url, "_blank", "noopener");
}

// ── upload (XHR for real progress + abort) ──────────────────────────────────

export interface UploadHandle {
  promise: Promise<DocumentDTO>;
  abort: () => void;
}

/**
 * Upload one file via XHR so the queue can show per-file progress and abort.
 * Retries once on network failure before surfacing the error.
 */
export function uploadDocumentFile(
  file: File,
  meta: Record<string, unknown>,
  onProgress?: (pct: number) => void,
  signalRef?: { xhr?: XMLHttpRequest }
): UploadHandle {
  let settled = false;
  const promise = new Promise<DocumentDTO>((resolve, reject) => {
    const attempt = (isRetry: boolean) => {
      const xhr = new XMLHttpRequest();
      if (signalRef) signalRef.xhr = xhr;
      xhr.open("POST", "/api/v1/documents-upload");
      xhr.responseType = "json";
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        const data = (xhr.response ?? null) as (DocumentDTO & { error?: string; message?: string }) | null;
        if (xhr.status >= 200 && xhr.status < 300 && data && !data.error) {
          settled = true;
          resolve(data);
        } else if (!isRetry && (xhr.status === 0 || xhr.status >= 500)) {
          setTimeout(() => attempt(true), 600); // one retry on network/5xx
        } else {
          reject(new ApiError(xhr.status || 0, data?.error ?? "upload_failed", data?.message ?? `Upload failed (${xhr.status}).`));
        }
      };
      xhr.onerror = () => {
        if (!isRetry) setTimeout(() => attempt(true), 600);
        else reject(new ApiError(0, "network", "Network error during upload — check your connection."));
      };
      xhr.onabort = () => {
        if (!settled) reject(new ApiError(499, "aborted", "Upload canceled."));
      };
      const form = new FormData();
      form.set("file", file);
      form.set("meta", JSON.stringify(meta));
      xhr.send(form);
    };
    attempt(false);
  });
  return {
    promise,
    abort: () => {
      if (signalRef?.xhr && signalRef.xhr.readyState !== 4) signalRef.xhr.abort();
    },
  };
}

// ── CSV / binary downloads (fetch → blob → anchor; never loads in-app state) ─

export async function downloadBinary(path: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  if (!res.ok) {
    let message = `Download failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch { /* binary or empty body */ }
    throw new ApiError(res.status, "download_failed", message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
