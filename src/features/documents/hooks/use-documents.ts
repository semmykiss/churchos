"use client";

/**
 * Document queries — thin wrappers over useApiQuery with a stable query-key
 * factory and keepPreviousData so paginating/filtering never flashes empty.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { useApiQuery } from "@/components/app/shared";
import type {
  DocumentsListResp,
  DocumentDetailResp,
  DocumentVersionDTO,
  DocumentCommentDTO,
  DocumentsSettingsDTO,
  FolderDTO,
  DocumentLookupUser,
} from "../types";
import type { DocumentFilters } from "../schemas";
import { docKeys, fetchDocuments, fetchDocument, fetchFolders, fetchVersions, fetchComments, fetchSettings, fetchLookupUsers, fetchLookupTags, filtersToQuery } from "../api/documents";

/** Main paged list (stats + access-level matrix embedded). */
export function useDocuments(filters: DocumentFilters, opts: { trash?: boolean; includeInfected?: boolean; enabled?: boolean } = {}) {
  return useApiQuery<DocumentsListResp>(
    docKeys.list(filters, Boolean(opts.trash)),
    `/documents${filtersToQuery(filters, opts.trash ? { trash: "1" } : opts.includeInfected ? { includeInfected: "1" } : {})}`,
    {
      placeholderData: keepPreviousData,
      // stale 30s — balances freshness with hammering the list endpoint
      staleTime: 30_000,
      enabled: opts.enabled !== false,
      queryFn: () => fetchDocuments(filters, opts),
    }
  );
}

export function useDocument(id: string | null) {
  return useApiQuery<DocumentDetailResp>(
    docKeys.detail(id),
    id ? `/documents/${id}` : `/documents/__none__`,
    { enabled: Boolean(id), staleTime: 15_000, queryFn: () => fetchDocument(id!) }
  );
}

export function useFolders() {
  return useApiQuery<FolderDTO[]>(docKeys.folders(), `/documents/folders`, {
    staleTime: 60_000,
    queryFn: () => fetchFolders(),
  });
}

export function useDocumentVersions(id: string | null) {
  return useApiQuery<DocumentVersionDTO[]>(
    docKeys.versions(id),
    id ? `/documents/${id}/versions` : `/documents/__none__/versions`,
    { enabled: Boolean(id), queryFn: () => fetchVersions(id!) }
  );
}

export function useDocumentComments(id: string | null) {
  return useApiQuery<DocumentCommentDTO[]>(
    docKeys.comments(id),
    id ? `/documents/${id}/comments` : `/documents/__none__/comments`,
    { enabled: Boolean(id), queryFn: () => fetchComments(id!) }
  );
}

export function useDocumentSettings(enabled: boolean) {
  return useApiQuery<DocumentsSettingsDTO>(docKeys.settings(), `/documents/settings`, {
    enabled,
    queryFn: () => fetchSettings(),
  });
}

export function useLookupUsers(enabled: boolean) {
  return useApiQuery<DocumentLookupUser[]>(docKeys.lookups(), `/documents/lookup/users`, {
    enabled,
    staleTime: 120_000,
    queryFn: () => fetchLookupUsers(),
  });
}

export function useLookupTags(enabled: boolean) {
  return useApiQuery<{ id: string; name: string; color: string }[]>(
    [...docKeys.lookups(), "tags"],
    `/documents/lookup/tags`,
    { enabled, staleTime: 60_000, queryFn: () => fetchLookupTags() }
  );
}
