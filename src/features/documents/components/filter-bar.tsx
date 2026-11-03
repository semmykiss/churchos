"use client";

/**
 * Sticky filter toolbar + collapsible filter sidebar.
 *  • "All" options use the ALL sentinel — mapped at the URL-state boundary
 *    (useDocumentFilters), fixing the classic Select "" mismatch bug.
 *  • Search is debounced 300 ms; every control writes straight to the URL.
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { fromSelect, toSelect } from "../hooks/use-document-filters";
import { useFolders, useLookupTags } from "../hooks/use-documents";
import { useDocumentMutations } from "../hooks/use-document-mutations";
import { ALL, ACCESS_LEVELS_DMS, ACCESS_LEVEL_META, DOCUMENT_CATEGORIES, CATEGORY_LABELS, DOCUMENT_STATUSES, STATUS_META, FILE_KINDS, FILE_KIND_LABELS, SORT_FIELDS, SORT_FIELD_LABELS, PAGE_SIZES, STRINGS, type DocumentSortField } from "../constants";
import type { DocumentFilters } from "../schemas";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/types";
import { canDo } from "@/lib/types";
import {
  Search, SlidersHorizontal, LayoutGrid, Table2, X, FolderPlus, CalendarRange, Star, Clock3, UploadCloud, ChevronDown, Loader2,
} from "lucide-react";

interface FilterBarProps {
  user: SessionUser;
  filters: DocumentFilters;
  onFilters: ReturnType<typeof import("../hooks/use-document-filters").useDocumentFilters>["setFilters"];
  onReset: () => void;
  view: "grid" | "table";
  onView: (v: "grid" | "table") => void;
  onUpload: () => void;
  sidebarOpen: boolean;
  onSidebar: (open: boolean) => void;
  activeCount: number;
}

export function FilterBar({ user, filters, onFilters, onReset, view, onView, onUpload, sidebarOpen, onSidebar, activeCount }: FilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canUpload = canDo(user, "documents.create");

  /** Debounced search push (300 ms) — timeout callback, no setState-in-effect. */
  const onSearchInput = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value === filters.q) return;
      debounceRef.current = setTimeout(() => onFilters({ q: value }), 300);
    },
    [filters.q, onFilters]
  );

  const clearSearch = useCallback(() => {
    setSearchInput("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (filters.q) onFilters({ q: "" });
  }, [filters.q, onFilters]);

  const sortValue: string = `${filters.sort}:${filters.dir}`;

  return (
    <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-background/95 px-1 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Document filters">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input
            id="doc-search"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder={STRINGS.searchPlaceholder}
            className="pl-8 pr-8"
            aria-label={STRINGS.searchPlaceholder}
          />
          {searchInput ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-muted hover:bg-accent hover:text-ink"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <Select value={toSelect(filters.category)} onValueChange={(v) => onFilters({ category: fromSelect(v) as DocumentFilters["category"] })}>
          <SelectTrigger className="w-[130px]" aria-label="Filter by category"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {DOCUMENT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={toSelect(filters.access)} onValueChange={(v) => onFilters({ access: fromSelect(v) as DocumentFilters["access"] })}>
          <SelectTrigger className="w-[120px]" aria-label="Filter by access level"><SelectValue placeholder="Access" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All access</SelectItem>
            {ACCESS_LEVELS_DMS.map((l) => (
              <SelectItem key={l} value={l}>{ACCESS_LEVEL_META[l].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={toSelect(filters.status)} onValueChange={(v) => onFilters({ status: fromSelect(v) as DocumentFilters["status"] })}>
          <SelectTrigger className="w-[130px]" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {DOCUMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={toSelect(filters.kind)} onValueChange={(v) => onFilters({ kind: fromSelect(v) })}>
          <SelectTrigger className="hidden w-[130px] sm:inline-flex" aria-label="Filter by file type"><SelectValue placeholder="File type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All file types</SelectItem>
            {FILE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{FILE_KIND_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sortValue}
          onValueChange={(v) => {
            const [sort, dir] = v.split(":");
            onFilters({ sort: sort as DocumentSortField, dir: dir as "asc" | "desc" });
          }}
        >
          <SelectTrigger className="w-[170px]" aria-label="Sort documents"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_FIELDS.map((s) => (
              <SelectItem key={s} value={`${s}:desc`}>{SORT_FIELD_LABELS[s]} ↓</SelectItem>
            ))}
            {SORT_FIELDS.map((s) => (
              <SelectItem key={`${s}-asc`} value={`${s}:asc`}>{SORT_FIELD_LABELS[s]} ↑</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center overflow-hidden rounded-lg border" role="group" aria-label="View mode">
          <button
            type="button"
            onClick={() => onView("grid")}
            aria-pressed={view === "grid"}
            aria-label={STRINGS.gridView}
            className={cn("flex h-9 items-center gap-1.5 px-2.5 text-sm transition-colors", view === "grid" ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:bg-accent")}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onView("table")}
            aria-pressed={view === "table"}
            aria-label={STRINGS.tableView}
            className={cn("flex h-9 items-center gap-1.5 px-2.5 text-sm transition-colors", view === "table" ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:bg-accent")}
          >
            <Table2 className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onSidebar(!sidebarOpen)} aria-expanded={sidebarOpen}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters
          {activeCount > 0 ? <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{activeCount}</Badge> : null}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", sidebarOpen && "rotate-180")} aria-hidden />
        </Button>

        {activeCount > 0 || filters.q ? (
          <Button variant="ghost" size="sm" onClick={onReset}>{STRINGS.clearFilters}</Button>
        ) : null}

        {canUpload ? (
          <Button size="sm" className="ml-auto gap-1.5" onClick={onUpload}>
            <UploadCloud className="h-4 w-4" aria-hidden /> {STRINGS.upload}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── collapsible sidebar: folders, tags, date range, scopes ──────────────────

interface FilterSidebarProps {
  user: SessionUser;
  filters: DocumentFilters;
  onFilters: (patch: Partial<DocumentFilters>) => void;
  activeCount: number;
}

export function FilterSidebar({ user, filters, onFilters, activeCount }: FilterSidebarProps) {
  const { data: folders, isLoading: foldersLoading } = useFolders();
  const { data: tags } = useLookupTags(true);
  const mutations = useDocumentMutations();
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = canDo(user, "documents.create");

  const createFolder = async () => {
    if (!folderName.trim()) return;
    setBusy(true);
    try {
      await mutations.createFolder(folderName.trim(), filters.folderId && filters.folderId !== "root" ? filters.folderId : undefined);
      setFolderName("");
      setCreating(false);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cn("border-dashed", activeCount > 0 && "border-primary/40")}>
      <CardContent className="grid gap-4 p-4 md:grid-cols-3">
        {/* folders */}
        <section aria-label="Folders" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Folders</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onFilters({ folderId: "" })}
              className={cn("rounded-full px-2.5 py-1 text-xs transition-colors", !filters.folderId ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary hover:bg-accent")}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onFilters({ folderId: "root" })}
              className={cn("rounded-full px-2.5 py-1 text-xs transition-colors", filters.folderId === "root" ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary hover:bg-accent")}
            >
              Unfiled
            </button>
            {(folders ?? []).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilters({ folderId: f.id })}
                className={cn("rounded-full px-2.5 py-1 text-xs transition-colors", filters.folderId === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary hover:bg-accent")}
              >
                {f.name} <span className="opacity-60">({f.documentCount})</span>
              </button>
            ))}
            {foldersLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" aria-label="Loading folders" /> : null}
            {canManage ? (
              creating ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    autoFocus
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createFolder();
                      if (e.key === "Escape") setCreating(false);
                    }}
                    placeholder="New folder name"
                    aria-label="New folder name"
                    className="w-32 rounded-full border px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button type="button" onClick={() => void createFolder()} className="rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground" disabled={busy}>
                    Add
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-ink-muted hover:border-primary hover:text-primary">
                  <FolderPlus className="h-3 w-3" aria-hidden /> New folder{filters.folderId && filters.folderId !== "root" ? " inside" : ""}
                </button>
              )
            ) : null}
          </div>
        </section>

        {/* scopes + tags */}
        <section aria-label="Quick views and tags" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Quick views</p>
          <div className="flex flex-wrap gap-1.5">
            {([
              ["", "All documents"],
              ["mine", STRINGS.myUploads],
              ["recent", STRINGS.recentlyViewed],
              ["favorites", STRINGS.favorites],
            ] as const).map(([value, label]) => (
              <label key={value || "all"} className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-ink-secondary has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10">
                <Checkbox
                  checked={filters.scope === value}
                  onCheckedChange={() => onFilters({ scope: value as DocumentFilters["scope"] })}
                  aria-label={label}
                />
                {value === "favorites" ? <Star className="h-3 w-3 text-warning" aria-hidden /> : value === "recent" ? <Clock3 className="h-3 w-3" aria-hidden /> : null}
                {label}
              </label>
            ))}
          </div>
          {tags?.length ? (
            <>
              <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => onFilters({ tag: "" })}
                  className={cn("rounded-full px-2.5 py-1 text-xs", !filters.tag ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary hover:bg-accent")}
                >
                  Any tag
                </button>
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onFilters({ tag: filters.tag === t.name ? "" : t.name })}
                    className={cn("rounded-full px-2.5 py-1 text-xs", filters.tag === t.name ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary hover:bg-accent")}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </section>

        {/* date range */}
        <section aria-label="Date range" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Updated between</p>
          <div className="flex items-center gap-2">
            <DatePick label="From date" value={filters.from} onChange={(d) => onFilters({ from: d })} />
            <span className="text-xs text-ink-muted">→</span>
            <DatePick label="To date" value={filters.to} onChange={(d) => onFilters({ to: d })} />
          </div>
          {filters.from || filters.to ? (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => onFilters({ from: "", to: "" })}>
              Clear dates
            </button>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

function DatePick({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-[120px] justify-start gap-1.5 text-xs font-normal" aria-label={label}>
          <CalendarRange className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
          {value ? value : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(d) => {
            onChange(d ? d.toISOString().slice(0, 10) : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-[110px]" aria-label="Results per page"><SelectValue /></SelectTrigger>
      <SelectContent>
        {PAGE_SIZES.map((n) => (
          <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
