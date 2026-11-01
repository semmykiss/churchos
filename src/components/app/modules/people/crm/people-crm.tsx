"use client";

/**
 * People CRM v2 — the next-gen People workspace (flag: people.crmV2).
 * Header + tabs (People | Households | Smart Lists | Data Health), clickable
 * permission-scoped insight tiles, debounced server search ("/" to focus),
 * AND/OR filter builder, cursor-paginated virtualized directory, placeholder
 * row drawer. The classic module stays reachable via the header toggle and
 * the per-user `peopleCrm.view` preference.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, type UseQueryOptions } from "@tanstack/react-query";
import {
  CalendarClock, ClipboardList, Columns3, Download, History, Home, Import,
  ListFilter, Plus, Search, ShieldCheck, TableProperties,
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
import { api, qs, type ApiError } from "@/lib/api";
import { FilterBuilder, FilterChips, sanitizeFilters, type FilterOptions } from "./crm-filters";
import { InsightsStrip, type InsightPreset } from "./crm-insights";
import { CrmTable } from "./crm-table";
import { CrmPersonDrawer } from "./crm-drawer";
import {
  CRM_COLUMNS, DEFAULT_COLUMNS, savePeopleCrmPrefs,
  type CrmColumnId, type CrmInsights, type CrmListResponse, type CrmPersonRow,
  type FilterGroup, type PeopleCrmPrefs,
} from "./crm-shared";

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
  onClassic: () => void;
  /** Rendered by the wrapper so the classic dialogs stay in one place. */
  renderAddDialog: (open: boolean, onClose: () => void, onDone: () => void) => React.ReactNode;
  renderDetailDialog: (personId: string, onClose: () => void) => React.ReactNode;
}

interface HouseholdCardDTO {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  members: { personId: string; name: string; photoUrl?: string | null; role: string }[];
}

export function PeopleCrm({ user, canCreate, onClassic, renderAddDialog, renderDetailDialog }: PeopleCrmProps) {
  const prefs: PeopleCrmPrefs = useMemo(() => {
    try {
      const raw = JSON.parse(user.preferences ?? "{}") as { peopleCrm?: PeopleCrmPrefs };
      return raw.peopleCrm ?? {};
    } catch {
      return {};
    }
  }, [user.preferences]);

  const [tab, setTab] = useState("people");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText, 250);
  const [filters, setFilters] = useState<FilterGroup | null>(null);
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [density, setDensity] = useState<"default" | "compact">(prefs.density ?? "default");
  const [columns, setColumns] = useState<CrmColumnId[]>(prefs.columns ?? DEFAULT_COLUMNS);
  const [addOpen, setAddOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<CrmPersonRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hhText, setHhText] = useState("");
  const hhSearch = useDebounced(hhText, 250);
  const searchRef = useRef<HTMLInputElement>(null);

  const sanitized = useMemo(() => sanitizeFilters(filters), [filters]);

  // ── queries ────────────────────────────────────────────────────────────────
  const insightsQ = useApiQuery<CrmInsights>(["people", "v2", "insights"], "/people/v2/insights");
  const optionsQ = useApiQuery<FilterOptions>(["people", "v2", "options"], "/people/v2/options", {
    staleTime: 300_000,
  } as Partial<UseQueryOptions<FilterOptions, ApiError>>);

  const listQ = useInfiniteQuery({
    queryKey: ["people", "v2", "list", { search, filters: sanitized, sort, dir }],
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

  const scopeLabel = insightsQ.data?.scope === "relationships"
    ? "your household, dependents & groups you lead"
    : "your whole church";

  const filterOptions: FilterOptions = useMemo(
    () => optionsQ.data ?? { campuses: [], groups: [], tags: [] },
    [optionsQ.data]
  );

  return (
    <TooltipProvider delayDuration={200}>
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
                <TooltipContent>Export joins Import in the data toolkit (Phase 3).</TooltipContent>
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
              <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
                {listQ.isLoading ? "…" : `${total} ${total === 1 ? "person" : "people"}`}
              </span>
            </div>

            {/* active filter chips */}
            {sanitized ? (
              <FilterChips filters={sanitized} options={filterOptions} onChange={setFilters} />
            ) : null}

            {/* the table */}
            <div className="min-h-[420px] flex-1">
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
            </div>
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
                          onClick={() => setDetailId(m.personId)}
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

          {/* ── Smart Lists tab (Phase 3 placeholder) ── */}
          <TabsContent value="smartlists" className="mt-4 outline-none">
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={ListFilter}
                title="Smart lists are on the way"
                description="Save any filter combo as a reusable list — newcomers, follow-ups, serving gaps. They'll live here with one-click filters and team sharing."
              />
            </div>
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

        <CrmPersonDrawer
          row={drawerRow}
          onClose={() => setDrawerRow(null)}
          onOpenFullRecord={(r) => {
            setDetailId(r.id);
            setDrawerRow(null);
          }}
        />

        {detailId ? renderDetailDialog(detailId, () => setDetailId(null)) : null}
      </div>
    </TooltipProvider>
  );
}
