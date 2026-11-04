"use client";

/**
 * Documents (DMS) module shell — stats, sticky filters, grid/table views,
 * bulk actions, detail side-sheet, upload queue, preview, trash, settings and
 * a ⌘K command palette. Heavy dialogs are lazy-loaded; state lives in the URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { PageHeader, EmptyState, LoadingBlock, ErrorBlock } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { useDocuments, useFolders } from "../hooks/use-documents";
import { useDocumentFilters } from "../hooks/use-document-filters";
import { useDocumentMutations } from "../hooks/use-document-mutations";
import { docKeys, downloadBinary } from "../api/documents";
import { useQueryClient } from "@tanstack/react-query";
import { FilterBar, FilterSidebar, PageSizeSelect } from "./filter-bar";
import { StatsBar, OfflineBanner, SandboxNotice } from "./stats-bar";
import { DocumentCard } from "./document-card";
import { DocumentsTable } from "./documents-table";
import { UploadDialog } from "./upload-dialog";
import { DetailSheet } from "./detail-sheet";
import { CommandSearch } from "./command-search";
import { ACCESS_LEVEL_META, STRINGS, VIEW_STORAGE_KEY, type DocumentsViewMode } from "../constants";
import type { DocumentDTO } from "../types";
import type { SessionUser } from "@/lib/types";
import { canDo, moduleLevel } from "@/lib/types";
import {
  FolderOpen, Trash2, Settings, Search, Download, ChevronRight, Ban,
} from "lucide-react";

// heavy, rarely-first-painted surfaces — lazy so the library view stays snappy
const PreviewDrawer = dynamic(() => import("./preview-drawer").then((m) => m.PreviewDrawer), { ssr: false });
const TrashDialog = dynamic(() => import("./trash-dialog").then((m) => m.TrashDialog), { ssr: false });
const SettingsDialog = dynamic(() => import("./settings-dialog").then((m) => m.SettingsDialog), { ssr: false });

export default function DocumentsModule({ user }: { user: SessionUser }) {
  const { filters, setFilters, resetFilters, setSearch } = useDocumentFilters();
  const list = useDocuments(filters);
  const { data: folders } = useFolders();
  const mutations = useDocumentMutations();
  const queryClient = useQueryClient();

  const [view, setView] = useState<DocumentsViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    try {
      const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
      return saved === "table" ? "table" : "grid";
    } catch {
      return "grid";
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentDTO | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [offline, setOffline] = useState(false); // navigator.onLine lies in headless/embedded contexts — trust events only
  const [filterEpoch, setFilterEpoch] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const canUpload = canDo(user, "documents.create");
  const canTrash = canDo(user, "documents.delete");
  const canSettings = canDo(user, "documents.settings");
  const canAudit = canDo(user, "documents.audit");

  // persisted view mode — reads happen in the lazy initializer above
  const changeView = useCallback((v: DocumentsViewMode) => {
    setView(v);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* ignore */ }
  }, []);

  // offline banner — subscribe only; initial value comes from the lazy initializer
  useEffect(() => {
    const on = () => setOffline(true);
    window.addEventListener("offline", on);
    return () => window.removeEventListener("offline", on);
  }, []);

  const openDetail = useCallback((doc: DocumentDTO) => {
    setDetailId(doc.id);
    setDetailOpen(true);
  }, []);

  const openPreview = useCallback((doc: DocumentDTO) => {
    setPreviewDoc(doc);
    setPreviewOpen(true);
  }, []);

  const activeFilterCount = useMemo(
    () => [filters.category, filters.access, filters.status, filters.kind, filters.owner, filters.tag, filters.folderId, filters.from, filters.to, filters.scope].filter(Boolean).length,
    [filters]
  );

  // ── keyboard shortcuts: / focus · n upload · Del trash · ⌘K palette · Esc ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.tagName === "SELECT";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("doc-search")?.focus();
      } else if (e.key.toLowerCase() === "n" && canUpload && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setUploadOpen(true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size && canTrash) {
        e.preventDefault();
        void mutations.bulk({ ids: [...selectedIds], action: "trash" }).then(() => setSelectedIds(new Set()));
      } else if (e.key === "Escape" && selectedIds.size) {
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUpload, canTrash, mutations, selectedIds]);

  const items = list.data?.items ?? [];
  const stats = list.data?.stats;
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));

  const onSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? new Set(items.map((d) => d.id)) : new Set());
  }, [items]);

  const onSort = useCallback((field: typeof filters.sort) => {
    setFilters(field === filters.sort ? { sort: field, dir: filters.dir === "asc" ? "desc" : "asc" } : { sort: field, dir: "desc" });
  }, [filters.sort, filters.dir, setFilters]);

  // access-level help derived from the same matrix the server enforces
  const accessMatrixForNotice = useMemo(
    () => Object.values(ACCESS_LEVEL_META).map((m) => ({
      label: m.label,
      description: m.description,
      count: list.data?.byAccessLevel?.[m.label.toLowerCase()] ?? 0,
    })),
    [list.data?.byAccessLevel]
  );

  if (moduleLevel(user, "documents") === 0 && !canDo(user, "documents.view")) {
    return (
      <div className="space-y-4">
        <PageHeader title={STRINGS.moduleTitle} description={STRINGS.moduleDescription} />
        <ErrorBlock error={new Error("Your role does not include Documents access. Ask an administrator to raise your access level.")} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={STRINGS.moduleTitle}
        description={STRINGS.moduleDescription}
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCommandOpen(true)}>
              <Search className="h-4 w-4" aria-hidden /> Search
              <kbd className="ml-1 hidden rounded border bg-muted px-1 font-mono text-[10px] text-ink-muted sm:inline">⌘K</kbd>
            </Button>
            {canAudit ? (
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={() => void downloadBinary("/documents/export").catch((e) => toast.error(e.message))}
              >
                <Download className="h-4 w-4" aria-hidden /> Export
              </Button>
            ) : null}
            {canTrash ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTrashOpen(true)}>
                <Trash2 className="h-4 w-4" aria-hidden /> {STRINGS.trash}
                {stats?.trashCount ? <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{stats.trashCount}</Badge> : null}
              </Button>
            ) : null}
            {canSettings ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" aria-hidden /> {STRINGS.settings}
              </Button>
            ) : null}
            {canUpload ? (
              <Button size="sm" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                + {STRINGS.upload}
              </Button>
            ) : null}
          </>
        }
      />

      {stats ? <StatsBar stats={stats} isAdmin={canTrash} /> : <StatsSkeleton />}
      <OfflineBanner show={offline} />
      <SandboxNotice matrix={accessMatrixForNotice} />

      <FilterBar
        key={filterEpoch}
        user={user}
        filters={filters}
        onFilters={setFilters}
        onReset={() => {
          resetFilters();
          setSelectedIds(new Set());
          setFilterEpoch((n) => n + 1); // remount the bar so the local search text clears too
        }}
        view={view}
        onView={changeView}
        onUpload={() => setUploadOpen(true)}
        sidebarOpen={sidebarOpen}
        onSidebar={setSidebarOpen}
        activeCount={activeFilterCount}
      />

      {sidebarOpen ? (
        <FilterSidebar user={user} filters={filters} onFilters={setFilters} activeCount={activeFilterCount} />
      ) : null}

      {/* folder breadcrumb */}
      {filters.folderId && filters.folderId !== "root" ? (
        <nav aria-label="Folder breadcrumb" className="flex items-center gap-1 text-sm text-ink-secondary">
          <button type="button" className="hover:text-ink hover:underline" onClick={() => setFilters({ folderId: "" })}>
            All documents
          </button>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium text-ink">{(folders ?? []).find((f) => f.id === filters.folderId)?.name ?? "Folder"}</span>
        </nav>
      ) : null}

      {/* bulk action bar */}
      {selectedIds.size > 0 ? (
        <BulkBar
          count={selectedIds.size}
          user={user}
          onClear={() => setSelectedIds(new Set())}
          onBulk={async (action, payload) => {
            await mutations.bulk({ ids: [...selectedIds], action, ...payload });
            setSelectedIds(new Set());
          }}
        />
      ) : null}

      {/* content */}
      {list.isLoading ? (
        view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-xl border p-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          <LoadingBlock />
        )
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : items.length === 0 ? (
        total === 0 && !filters.q && !activeFilterCount ? (
          <EmptyState
            icon={FolderOpen}
            title={STRINGS.empty}
            description={STRINGS.emptyHint}
            action={canUpload ? <Button size="sm" onClick={() => setUploadOpen(true)}>+ {STRINGS.upload}</Button> : undefined}
          />
        ) : (
          <EmptyState icon={Search} title={STRINGS.noResults} description={STRINGS.noResultsHint} />
        )
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              query={filters.q}
              selected={selectedIds.has(doc.id)}
              onSelect={onSelect}
              onOpen={openDetail}
              onToggleFavorite={(d) => void mutations.toggleFavorite(d)}
            />
          ))}
        </div>
      ) : (
        <DocumentsTable
          items={items}
          query={filters.q}
          sort={filters.sort}
          dir={filters.dir}
          onSort={onSort}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onSelectAll={onSelectAll}
          onOpen={openDetail}
          onToggleFavorite={(d) => void mutations.toggleFavorite(d)}
        />
      )}

      {/* pagination */}
      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-muted" aria-live="polite">
            {total === 0 ? "No documents" : `Showing ${(filters.page - 1) * filters.pageSize + 1}–${Math.min(filters.page * filters.pageSize, total)} of ${total}`}
          </p>
          <div className="flex items-center gap-3">
            <PageSizeSelect value={filters.pageSize} onChange={(n) => setFilters({ pageSize: n })} />
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (filters.page > 1) setFilters({ page: filters.page - 1 });
                    }}
                    aria-disabled={filters.page <= 1}
                    className={filters.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                  />
                </PaginationItem>
                {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => {
                  const p = Math.max(1, Math.min(pageCount - 4, filters.page - 2)) + i;
                  if (p > pageCount) return null;
                  return (
                    <PaginationItem key={p}>
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setFilters({ page: p });
                        }}
                        isActive={p === filters.page}
                        aria-label={`Page ${p}`}
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (filters.page < pageCount) setFilters({ page: filters.page + 1 });
                    }}
                    aria-disabled={filters.page >= pageCount}
                    className={filters.page >= pageCount ? "pointer-events-none opacity-50" : undefined}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      ) : null}

      {/* dialogs & sheets */}
      <UploadDialog
        key={filters.folderId ?? "root"}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        user={user}
        folders={folders ?? []}
        defaultFolderId={filters.folderId && filters.folderId !== "root" ? filters.folderId : null}
        onUploaded={() => {
          queryClient.invalidateQueries({ queryKey: docKeys.all() });
        }}
      />
      <DetailSheet
        key={`detail-${detailId ?? "none"}`}
        documentId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        user={user}
        query={filters.q}
        onPreview={openPreview}
        onChanged={() => queryClient.invalidateQueries({ queryKey: docKeys.all() })}
      />
      <PreviewDrawer key={`preview-${previewDoc?.id ?? "none"}`} doc={previewDoc} open={previewOpen} onOpenChange={setPreviewOpen} />
      {canTrash ? (
        <TrashDialog
          open={trashOpen}
          onOpenChange={setTrashOpen}
          filters={filters}
          canPurge={canTrash}
          onChanged={() => queryClient.invalidateQueries({ queryKey: docKeys.all() })}
        />
      ) : null}
      {canSettings ? <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} /> : null}
      {commandOpen ? (
        <CommandSearch open={commandOpen} onOpenChange={setCommandOpen} onOpenDocument={openDetail} />
      ) : null}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border p-5">
          <Skeleton className="mx-auto h-7 w-12" />
          <Skeleton className="mx-auto h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function BulkBar({ count, user, onClear, onBulk }: {
  count: number;
  user: SessionUser;
  onClear: () => void;
  onBulk: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const canEdit = canDo(user, "documents.edit");
  const canApprove = canDo(user, "documents.approve");
  const canTrash = canDo(user, "documents.delete");

  const run = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onBulk(action, payload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5" role="toolbar" aria-label={`Bulk actions for ${count} selected documents`}>
      <span className="text-sm font-medium text-ink">{count} selected</span>
      <span className="flex-1" />
      {canEdit ? (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("setCategory", { category: "policy" })}>Mark as Policy</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("setAccess", { accessLevel: "staff" })}>Set access: Staff</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("moveToFolder", { folderId: null })}>Unfile</Button>
        </>
      ) : null}
      {canApprove ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("archive")}>Archive</Button>
      ) : null}
      {canTrash ? (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("trash")} title="Move to Trash (Del)">
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Trash
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("restore")}>Restore</Button>
        </>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection (Esc)">
        <Ban className="h-3.5 w-3.5" aria-hidden /> Clear
      </Button>
    </div>
  );
}
