"use client";

/**
 * URL-backed filter state for the documents module.
 *
 * Known-issue fixes baked in:
 *  • "All" sentinel — shadcn Select cannot use "" as an item value, so items
 *    use ALL ("all"); this hook maps ALL ⇄ "" at the URL boundary so the
 *    canonical filter state is always the empty string.
 *  • Every filter/sort/page/pageSize is synced to the URL (replaceState, no
 *    history spam) and re-hydrated on popstate — shareable, refresh-safe.
 *  • Changing any filter (except pageSize) resets to page 1.
 */
import { useCallback, useEffect, useState } from "react";
import { filtersSchema, type DocumentFilters } from "../schemas";
import { ALL } from "../constants";

const DEFAULTS: DocumentFilters = filtersSchema.parse({});

function parseFromUrl(search: string): DocumentFilters {
  const sp = new URLSearchParams(search);
  const parsed = filtersSchema.safeParse({
    q: sp.get("q") ?? "",
    category: sp.get("category") ?? "",
    access: sp.get("access") ?? "",
    status: sp.get("status") ?? "",
    kind: sp.get("kind") ?? "",
    owner: sp.get("owner") ?? "",
    tag: sp.get("tag") ?? "",
    folderId: sp.get("folderId") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    scope: sp.get("scope") ?? "",
    sort: sp.get("sort") ?? "updatedAt",
    dir: sp.get("dir") ?? "desc",
    page: sp.get("page") ?? "1",
    pageSize: sp.get("pageSize") ?? "12",
  });
  return parsed.success ? parsed.data : DEFAULTS;
}

function writeUrl(filters: DocumentFilters) {
  const sp = new URLSearchParams();
  if (filters.q) sp.set("q", filters.q);
  if (filters.category) sp.set("category", filters.category);
  if (filters.access) sp.set("access", filters.access);
  if (filters.status) sp.set("status", filters.status);
  if (filters.kind) sp.set("kind", filters.kind);
  if (filters.owner) sp.set("owner", filters.owner);
  if (filters.tag) sp.set("tag", filters.tag);
  if (filters.folderId) sp.set("folderId", filters.folderId);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.scope) sp.set("scope", filters.scope);
  if (filters.sort !== "updatedAt") sp.set("sort", filters.sort);
  if (filters.dir !== "desc") sp.set("dir", filters.dir);
  if (filters.page > 1) sp.set("page", String(filters.page));
  if (filters.pageSize !== 12) sp.set("pageSize", String(filters.pageSize));
  const qs = sp.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

/** Select item value ⇄ canonical state ("all" ⇄ ""). */
export function fromSelect(value: string): string {
  return value === ALL ? "" : value;
}
export function toSelect(value: string): string {
  return value || ALL;
}

export interface DocumentFiltersApi {
  filters: DocumentFilters;
  setFilters: (patch: Partial<DocumentFilters>) => void;
  resetFilters: () => void;
  setSearch: (q: string) => void;
}

export function useDocumentFilters(): DocumentFiltersApi {
  const [filters, setFiltersState] = useState<DocumentFilters>(() =>
    typeof window === "undefined" ? DEFAULTS : parseFromUrl(window.location.search)
  );

  // back/forward navigation re-hydrates state
  useEffect(() => {
    const onPop = () => setFiltersState(parseFromUrl(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setFilters = useCallback((patch: Partial<DocumentFilters>) => {
    setFiltersState((prev) => {
      const resetsPage = Object.keys(patch).some((k) => k !== "page" && k !== "pageSize");
      const next = filtersSchema.parse({
        ...prev,
        ...patch,
        page: patch.page ?? (resetsPage ? 1 : prev.page),
      });
      writeUrl(next);
      return next;
    });
  }, []);

  const setSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);

  const resetFilters = useCallback(() => {
    setFiltersState((prev) => {
      const next = { ...DEFAULTS, pageSize: prev.pageSize };
      writeUrl(next);
      return next;
    });
  }, []);

  return { filters, setFilters, resetFilters, setSearch };
}
