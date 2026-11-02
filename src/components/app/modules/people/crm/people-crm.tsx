"use client";

/**
 * People CRM v2 — the next-gen People workspace (flag: people.crmV2).
 * Header + tabs (People | Households | Smart Lists | Data Health), clickable
 * permission-scoped insight tiles, debounced server search ("/" to focus),
 * AND/OR filter builder, cursor-paginated virtualized directory, placeholder
 * row drawer. The classic module stays reachable via the header toggle and
 * the per-user `peopleCrm.view` preference.
 *
 * Phase 3: Table | Cards | Board view switcher, multi-select + bulk bar
 * (server re-checks permissions per record), saved smart views (system /
 * personal / shared), "save current view" — all re-entering the SAME scoped
 * list endpoint, so a view or a bulk run can never widen what a viewer sees.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import {
  BookmarkPlus, CalendarClock, ClipboardList, Columns3, Download, History, Home, Import,
  KanbanSquare, LayoutGrid, ListFilter, Plus, Search, ShieldCheck, Table2,
  TableProperties,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import { api, qs, ApiError } from "@/lib/api";
import { STAGE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FilterBuilder, FilterChips, sanitizeFilters, type FilterOptions } from "./crm-filters";
import { InsightsStrip, type InsightPreset } from "./crm-insights";
import { CrmTable } from "./crm-table";
import { CrmCards } from "./crm-cards";
import { CrmBoard } from "./crm-board";
import { CrmBulkBar, type BulkAction } from "./crm-bulk-bar";
import { PersonProfilePage, PersonPeekDrawer, type ProfilePerms } from "./crm-profile";
import { SaveViewDialog, SmartListsTab, type ViewDraft } from "./crm-views";
import {
  CRM_COLUMNS, DEFAULT_COLUMNS, savePeopleCrmPrefs,
  type CrmColumnId, type CrmInsights, type CrmListResponse, type CrmPersonRow,
  type CrmViewMode, type BulkResult, type FilterGroup, type PeopleCrmPrefs,
  type SavedViewDTO,
} from "./crm-shared";

/** Board view stops auto-loading beyond this many cards (refine instead). */
const BOARD_CAP = 600;

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface PeopleCrmProps extends ModuleProps {
  canCreate: boolean;
  /** Phase 3 capability flags — UI hiding only; the server decides for real. */
  canBulk: boolean;
  canViewsManage: boolean;
  canEditPeople: boolean;
  canTags: boolean;
  canGroups: boolean;
  canArchive: boolean;
  onClassic: () => void;
  /** Rendered by the wrapper so the classic dialogs stay in one place. */
  renderAddDialog: (open: boolean, onClose: () => void, onDone: () => void) => React.ReactNode;
}

interface HouseholdCardDTO {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  members: { personId: string; name: string; photoUrl?: string | null; role: string }[];
}

const VIEW_MODES: { id: CrmViewMode; label: string; icon: React.ElementType }[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "cards", label: "Cards", icon: LayoutGrid },
  { id: "board", label: "Board", icon: KanbanSquare },
];

export function PeopleCrm({
  user, canCreate, canBulk, canViewsManage, canEditPeople, canTags, canGroups, canArchive,
  onClassic, renderAddDialog,
}: PeopleCrmProps) {
  const qc = useQueryClient();
  const prefs: PeopleCrmPrefs = useMemo(() => {
    try {
      const raw = JSON.parse(user.preferences ?? "{}") as { peopleCrm?: PeopleCrmPrefs };
      return raw.peopleCrm ?? {};
    } catch {
      return {};
    }
  }, [user.preferences]);

  const [tab, setTab] = useState("people");
  const [viewMode, setViewMode] = useState<CrmViewMode>(prefs.viewMode ?? "table");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText, 250);
  const [filters, setFilters] = useState<FilterGroup | null>(null);
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [density, setDensity] = useState<"default" | "compact">(prefs.density ?? "default");
  const [columns, setColumns] = useState<CrmColumnId[]>(
    prefs.columns?.filter((c): c is CrmColumnId => CRM_COLUMNS.some((x) => x.id === c)) ?? DEFAULT_COLUMNS
  );
  const [addOpen, setAddOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<CrmPersonRow | null>(null);
  const [hhText, setHhText] = useState("");
  const hhSearch = useDebounced(hhText, 250);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Phase 4: Profile 360 — full page + peek drawer share the same comps ────
  // Deep-linkable via #/people/:id (the app itself is a single route; the hash
  // survives refresh and the browser back button walks the profile history).
  const [profileId, setProfileId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return /^#\/people\/([\w-]+)/.exec(window.location.hash)?.[1] ?? null;
  });
  const openProfile = useCallback((id: string) => {
    setDrawerRow(null);
    setProfileId(id);
    window.history.pushState({ chmsProfile: id }, "", `#/people/${id}`);
  }, []);
  const closeProfile = useCallback(() => {
    setProfileId(null);
    window.history.pushState({}, "", window.location.pathname + window.location.search);
  }, []);
  useEffect(() => {
    const onPop = () => setProfileId(/^#\/people\/([\w-]+)/.exec(window.location.hash)?.[1] ?? null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const profilePerms: ProfilePerms = useMemo(
    () => ({ canEditPeople, canTags, canGroups }),
    [canEditPeople, canTags, canGroups]
  );

  // ── Phase 3: selection + bulk state ────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkSnapshot, setBulkSnapshot] = useState<{ search: string; filters: FilterGroup | null } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const sanitized = useMemo(() => sanitizeFilters(filters), [filters]);
  const listKey = useMemo(
    () => ["people", "v2", "list", { search, filters: sanitized, sort, dir }] as const,
    [search, sanitized, sort, dir]
  );

  // ── queries ────────────────────────────────────────────────────────────────
  const insightsQ = useApiQuery<CrmInsights>(["people", "v2", "insights"], "/people/v2/insights");
  const optionsQ = useApiQuery<FilterOptions>(["people", "v2", "options"], "/people/v2/options", {
    staleTime: 300_000,
  } as Partial<UseQueryOptions<FilterOptions, ApiError>>);

  const listQ = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      api.post<CrmListResponse>("/people/v2/list", {
        search: search || undefined,
        filters: sanitized ?? undefined,
        sort,
        dir,
        cursor: pageParam,
        pageSize: 100,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const hhQ = useApiQuery<{ items: HouseholdCardDTO[] }>(
    ["households", hhSearch],
    `/households${qs({ search: hhSearch || undefined })}`,
    { enabled: tab === "households" },
  );

  const rows = useMemo(() => listQ.data?.pages.flatMap((p) => p.items) ?? [], [listQ.data]);
  const total = listQ.data?.pages[0]?.total ?? 0;
  const stageCounts = listQ.data?.pages[0]?.stageCounts;

  // Selection follows the matching set: any change to search/filters resets it.
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAllMatching(false);
    setBulkSnapshot(null);
  }, []);
  useEffect(() => {
    clearSelection();
  }, [search, sanitized, clearSelection]);

  const selectedCount = allMatching ? total : selectedIds.size;

  const toggleRow = useCallback((id: string) => {
    setAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setAllMatching(false);
    setSelectedIds((prev) => {
      const allSelected = rows.length > 0 && rows.every((r) => prev.has(r.id));
      return allSelected ? new Set() : new Set(rows.map((r) => r.id));
    });
  }, [rows]);

  const selectAllMatching = useCallback(() => {
    setAllMatching(true);
    setSelectedIds(new Set());
    setBulkSnapshot({ search, filters: sanitized });
  }, [search, sanitized]);

  /** ONE bulk entry point — the server re-checks permissions per record. */
  const runBulk = useCallback(async (action: BulkAction, params: Record<string, unknown>): Promise<BulkResult> => {
    const body = allMatching && bulkSnapshot
      ? { action, allMatching: true, search: bulkSnapshot.search || undefined, filters: bulkSnapshot.filters ?? undefined, params }
      : { action, personIds: [...selectedIds], params };
    const res = await api.post<BulkResult>("/people/bulk", body);
    void qc.invalidateQueries({ queryKey: ["people"] });
    return res;
  }, [allMatching, bulkSnapshot, selectedIds, qc]);

  /** CSV download of the selection (or all matching) via the v2 export. */
  const exportSelection = useCallback(async () => {
    const body = allMatching && bulkSnapshot
      ? { search: bulkSnapshot.search || undefined, filters: bulkSnapshot.filters ?? undefined }
      : { personIds: [...selectedIds] };
    try {
      const res = await fetch("/api/v1/people/v2/export.csv", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = "Export failed.";
        try {
          const j = await res.json();
          msg = j?.message ?? msg;
        } catch { /* not json */ }
        toast.error(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "people-export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export ready — check your downloads");
    } catch {
      toast.error("Export failed.");
    }
  }, [allMatching, bulkSnapshot, selectedIds]);

  /** Board drag: optimistic stage move through the EXISTING stage endpoint,
   *  rolled back by refetching the truth when the server rejects it. */
  const movePerson = useCallback((personId: string, fromStage: string, toStage: string) => {
    if (fromStage === toStage) return;
    setMovingId(personId);
    qc.setQueryData<unknown>(listKey, (old: CrmListResponse & { pages: CrmListResponse[]; pageParams: unknown[] } | undefined) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((it) => (it.id === personId ? { ...it, lifecycleStage: toStage } : it)),
          stageCounts: p.stageCounts
            ? {
                ...p.stageCounts,
                [fromStage]: Math.max(0, (p.stageCounts[fromStage] ?? 0) - 1),
                [toStage]: (p.stageCounts[toStage] ?? 0) + 1,
              }
            : p.stageCounts,
        })),
      };
    });
    void (async () => {
      try {
        await api.post(`/people/${personId}/stage`, { stage: toStage });
        toast.success(`Moved to ${STAGE_LABELS[toStage] ?? toStage}`);
        void qc.invalidateQueries({ queryKey: ["people", "v2", "insights"] });
      } catch (err) {
        void qc.invalidateQueries({ queryKey: listKey }); // rollback to server truth
        toast.error(err instanceof ApiError ? err.message : "Could not move that person.");
      } finally {
        setMovingId(null);
      }
    })();
  }, [qc, listKey]);

  // Board mode: auto-load pages up to the cap so columns feel complete.
  useEffect(() => {
    if (tab !== "people" || viewMode !== "board") return;
    if (rows.length >= BOARD_CAP || !listQ.hasNextPage || listQ.isFetchingNextPage) return;
    void listQ.fetchNextPage();
  }, [tab, viewMode, rows.length, listQ.hasNextPage, listQ.isFetchingNextPage, listQ.fetchNextPage]);

  // ── "/" focuses search (unless typing somewhere else or a dialog is open) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement | null)?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setTab("people");
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSortChange = useCallback((id: string) => {
    setSort((prevSort) => {
      if (prevSort === id) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
        return prevSort;
      }
      setDir("asc");
      return id;
    });
  }, []);

  const onPreset = useCallback((preset: InsightPreset) => {
    setFilters(preset.filter(new Date()));
    setTab("people");
  }, []);

  const switchViewMode = useCallback((m: CrmViewMode) => {
    setViewMode(m);
    void savePeopleCrmPrefs({ viewMode: m });
  }, []);

  const updateDensity = (d: "default" | "compact") => {
    setDensity(d);
    void savePeopleCrmPrefs({ density: d });
  };
  const toggleColumn = (id: CrmColumnId) => {
    setColumns((prev) => {
      let next: CrmColumnId[];
      if (prev.includes(id)) {
        if (prev.length === 1 || id === "name") return prev; // "name" always stays
        next = prev.filter((c) => c !== id);
      } else {
        next = CRM_COLUMNS.filter((c) => prev.includes(c.id) || c.id === id).map((c) => c.id);
      }
      void savePeopleCrmPrefs({ columns: next });
      return next;
    });
  };

  /** Open a saved view: resets the matching set to EXACTLY the view's filters. */
  const applyView = useCallback((v: SavedViewDTO) => {
    setSearchText("");
    setFilters(
      v.filters && v.filters.conditions.length > 0
        ? { match: v.filters.match === "any" ? "any" : "all", conditions: v.filters.conditions.map((c) => ({ ...c })) }
        : null
    );
    if (v.sort) {
      setSort(v.sort.sort);
      setDir(v.sort.dir);
    }
    if (v.columns && v.columns.length > 0) {
      const valid = v.columns.filter((c): c is CrmColumnId => CRM_COLUMNS.some((x) => x.id === c));
      if (valid.length > 0) setColumns(valid.includes("name") ? valid : ["name", ...valid]);
    }
    const mode = v.viewType ?? "table";
    setViewMode(mode);
    void savePeopleCrmPrefs({ viewMode: mode });
    clearSelection();
    setTab("people");
  }, [clearSelection]);

  const scopeLabel = insightsQ.data?.scope === "relationships"
    ? "your household, dependents & groups you lead"
    : "your whole church";

  const filterOptions: FilterOptions = useMemo(
    () => optionsQ.data ?? { campuses: [], groups: [], tags: [] },
    [optionsQ.data]
  );

  const saveDraft: ViewDraft = useMemo(
    () => ({ filters: sanitized, columns, sort: { sort, dir }, viewType: viewMode }),
    [sanitized, columns, sort, dir, viewMode]
  );

  return (
    <TooltipProvider delayDuration={200}>
      {/* ── Phase 4: full Profile 360 page replaces the workspace ── */}
      {profileId ? (
        <PersonProfilePage
          personId={profileId}
          onBack={closeProfile}
          perms={profilePerms}
          onOpenPerson={openProfile}
        />
      ) : (
      <div className="flex min-h-0 flex-col gap-5">
        <PageHeader
          title="People"
          description="Your congregation at a glance — insights, households, follow-up and data health."
          actions={
            <>
              <Button type="button" variant="ghost" onClick={onClassic} aria-label="Switch to the classic People view">
                <History className="h-4 w-4" /> Classic view
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" disabled aria-disabled>
                    <Import className="h-4 w-4" /> Import
                  </Button>
                </TooltipTrigger>
                <TooltipContent>CSV import arrives with the data toolkit (Phase 3).</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" disabled aria-disabled>
                    <Download className="h-4 w-4" /> Export
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Use “Export selection” in the bulk bar, or Export on a smart list (Phase 3).</TooltipContent>
              </Tooltip>
              {canCreate ? (
                <Button type="button" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" /> Add person
                </Button>
              ) : null}
            </>
          }
        />

        <Tabs value={tab} onValueChange={setTab} className="min-h-0">
          <TabsList aria-label="People sections">
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="households">Households</TabsTrigger>
            <TabsTrigger value="smartlists">Smart Lists</TabsTrigger>
            <TabsTrigger value="datahealth">Data Health</TabsTrigger>
          </TabsList>

          {/* ── People tab ── */}
          <TabsContent value="people" className="mt-4 flex min-h-0 flex-col gap-4 outline-none">
            <InsightsStrip
              insights={insightsQ.data}
              isLoading={insightsQ.isLoading}
              activeFilters={sanitized}
              onSelect={onPreset}
              scopeLabel={scopeLabel}
            />

            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  ref={searchRef}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search name, phone, email, household or tag…"
                  className="pl-8"
                  aria-label="Search people"
                />
              </div>
              <FilterBuilder filters={filters} options={filterOptions} onChange={setFilters} />
              {/* view switcher (Phase 3): Table | Cards | Board */}
              <div className="flex overflow-hidden rounded-md border" role="group" aria-label="View mode">
                {VIEW_MODES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      viewMode === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    )}
                    aria-pressed={viewMode === id}
                    onClick={() => switchViewMode(id)}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden md:inline">{label}</span>
                  </button>
                ))}
              </div>
              {viewMode === "table" ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" aria-label="Row density">
                        <TableProperties className="h-4 w-4" aria-hidden />
                        <span className="hidden sm:inline">{density === "compact" ? "Compact" : "Comfy"}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">Row density</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={density} onValueChange={(v) => updateDensity(v as "default" | "compact")}>
                        <DropdownMenuRadioItem value="default">Comfy</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" aria-label="Choose columns">
                        <Columns3 className="h-4 w-4" aria-hidden />
                        <span className="hidden sm:inline">Columns</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto scroll-slim">
                      <DropdownMenuLabel className="text-xs">Visible columns</DropdownMenuLabel>
                      {CRM_COLUMNS.map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={columns.includes(c.id)}
                          onCheckedChange={() => toggleColumn(c.id)}
                          disabled={c.id === "name"}
                          onSelect={(e) => e.preventDefault()}
                          aria-label={`${columns.includes(c.id) ? "Hide" : "Show"} ${c.label} column`}
                        >
                          {c.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveOpen(true)}
                aria-label="Save current view as a smart list"
              >
                <BookmarkPlus className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Save view</span>
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
                {listQ.isLoading ? "…" : `${total} ${total === 1 ? "person" : "people"}`}
              </span>
            </div>

            {/* active filter chips */}
            {sanitized ? (
              <FilterChips filters={sanitized} options={filterOptions} onChange={setFilters} />
            ) : null}

            {/* the active view */}
            <div className="min-h-[420px] flex-1">
              {viewMode === "cards" ? (
                <CrmCards
                  rows={rows}
                  totalCount={total}
                  isLoading={listQ.isLoading}
                  isFetchingNextPage={listQ.isFetchingNextPage}
                  hasNextPage={listQ.hasNextPage}
                  error={listQ.error}
                  hasNarrowing={Boolean(search || sanitized)}
                  selection={canBulk ? selectedIds : null}
                  onToggleRow={toggleRow}
                  onRowOpen={setDrawerRow}
                  onLoadMore={() => void listQ.fetchNextPage()}
                  onClearNarrowing={() => {
                    setSearchText("");
                    setFilters(null);
                  }}
                  emptyAction={
                    canCreate ? (
                      <Button type="button" onClick={() => setAddOpen(true)}>
                        <Plus className="h-4 w-4" /> Add person
                      </Button>
                    ) : undefined
                  }
                />
              ) : viewMode === "board" ? (
                <CrmBoard
                  rows={rows}
                  stageCounts={stageCounts}
                  canDrag={canEditPeople}
                  isLoading={listQ.isLoading}
                  totalCount={total}
                  onMovePerson={movePerson}
                  isMoving={movingId !== null}
                  onRowOpen={setDrawerRow}
                />
              ) : (
                <CrmTable
                  rows={rows}
                  density={density}
                  columns={columns}
                  sort={sort}
                  dir={dir}
                  totalCount={total}
                  isLoading={listQ.isLoading}
                  isFetchingNextPage={listQ.isFetchingNextPage}
                  hasNextPage={listQ.hasNextPage}
                  error={listQ.error}
                  hasNarrowing={Boolean(search || sanitized)}
                  selection={canBulk ? selectedIds : null}
                  onToggleRow={toggleRow}
                  onToggleAll={toggleAll}
                  onSortChange={onSortChange}
                  onRowOpen={setDrawerRow}
                  onLoadMore={() => void listQ.fetchNextPage()}
                  onClearNarrowing={() => {
                    setSearchText("");
                    setFilters(null);
                  }}
                  emptyAction={
                    canCreate ? (
                      <Button type="button" onClick={() => setAddOpen(true)}>
                        <Plus className="h-4 w-4" /> Add person
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </div>

            {/* bulk bar (Phase 3) — the server re-checks every record */}
            {canBulk && selectedCount > 0 && !listQ.isLoading ? (
              <CrmBulkBar
                selectedCount={selectedCount}
                totalMatching={total}
                allMatching={allMatching}
                options={filterOptions}
                canTags={canTags}
                canGroups={canGroups}
                canArchive={canArchive}
                onSelectAllMatching={selectAllMatching}
                onRun={runBulk}
                onExport={() => void exportSelection()}
                onDone={clearSelection}
              />
            ) : null}
          </TabsContent>

          {/* ── Households tab ── */}
          <TabsContent value="households" className="mt-4 space-y-4 outline-none">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={hhText}
                  onChange={(e) => setHhText(e.target.value)}
                  placeholder="Search households…"
                  className="pl-8"
                  aria-label="Search households"
                />
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {hhQ.data ? `${hhQ.data.items.length} ${hhQ.data.items.length === 1 ? "household" : "households"}` : "…"}
              </span>
            </div>
            {hhQ.isLoading ? (
              <LoadingBlock label="Loading households…" />
            ) : hhQ.error ? (
              <ErrorBlock error={hhQ.error} />
            ) : (hhQ.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon={Home}
                title="No households found"
                description={hhSearch ? `Nothing matches “${hhSearch}”.` : "Households appear as people are added to families."}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {hhQ.data?.items.map((h) => (
                  <div key={h.id} className="rounded-lg border bg-card p-4 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                          <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{h.name}</span>
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[h.city, h.region].filter(Boolean).join(", ") || "No address on file"}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {h.members.length} member{h.members.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <div className="flex -space-x-1.5" aria-hidden>
                        {h.members.slice(0, 6).map((m) => (
                          <PersonAvatar key={m.personId} name={m.name} src={m.photoUrl} className="h-7 w-7 text-[9px]" />
                        ))}
                      </div>
                      <span className="sr-only">{h.members.map((m) => m.name).join(", ")}</span>
                      {h.members.slice(0, 3).map((m) => (
                        <button
                          key={m.personId}
                          type="button"
                          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => openProfile(m.personId)}
                        >
                          {m.name.split(" ")[0]}
                        </button>
                      ))}
                      {h.members.length > 3 ? <span className="text-xs text-muted-foreground">+{h.members.length - 3} more</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Smart Lists tab (Phase 3: saved views) ── */}
          <TabsContent value="smartlists" className="mt-4 outline-none">
            <SmartListsTab
              options={filterOptions}
              canViewsManage={canViewsManage}
              onApply={applyView}
              onSaveCurrent={() => setSaveOpen(true)}
            />
          </TabsContent>

          {/* ── Data Health tab (Phase 3 placeholder) ── */}
          <TabsContent value="datahealth" className="mt-4 space-y-3 outline-none">
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={ShieldCheck}
                title="Data health checks are being wired up"
                description="The engine already flags missing contact details, stale attendance and guardian gaps server-side — the guided repair flow lands with the data toolkit."
              />
            </div>
            <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"><CalendarClock className="h-4 w-4 text-warning" aria-hidden /> People not seen in 4+ weeks</li>
              <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"><ClipboardList className="h-4 w-4" aria-hidden /> Missing phone / email records</li>
              <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"><ShieldCheck className="h-4 w-4 text-danger" aria-hidden /> Minors without a guardian</li>
              <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"><ListFilter className="h-4 w-4" aria-hidden /> Possible duplicates to merge</li>
            </ul>
          </TabsContent>
        </Tabs>

        {renderAddDialog(
          addOpen,
          () => setAddOpen(false),
          () => {
            setAddOpen(false);
            void listQ.refetch();
            void insightsQ.refetch();
            toast.success("Person added");
          },
        )}

        {/* Phase 4 peek drawer — the SAME profile components in a Sheet */}
        <PersonPeekDrawer
          personId={drawerRow?.id ?? null}
          onClose={() => setDrawerRow(null)}
          onOpenFull={(id) => openProfile(id)}
          perms={profilePerms}
          rowName={drawerRow ? `${drawerRow.firstName} ${drawerRow.lastName}` : null}
          rowPhoto={drawerRow?.photoUrl ?? null}
        />

        <SaveViewDialog
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          onSaved={() => { /* lists refresh via query invalidation */ }}
          draft={saveDraft}
          editing={null}
          canViewsManage={canViewsManage}
        />
      </div>
      )}
    </TooltipProvider>
  );
}
