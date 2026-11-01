"use client";

/**
 * People CRM v2 — virtualized people table (@tanstack/react-virtual).
 * Infinite cursor paging (append), server-driven sort, sticky header, density
 * toggle, hover contact actions, household avatar stack. Rows are plain grids
 * with table roles for screen readers; all field visibility was already
 * decided by the server serializer.
 */
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, Clock, Loader2, Mail,
  MessageCircle, Minus, Phone, UserCheck, UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorBlock, PersonAvatar, StageBadge, type ModuleProps,
} from "@/components/app/shared";
import { CRM_COLUMNS, relLastSeen, waLink, type CrmColumnId, type CrmPersonRow } from "./crm-shared";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/types";

const COLUMN_WIDTHS: Record<CrmColumnId, string> = {
  name: "minmax(210px, 1.7fr)",
  contact: "minmax(180px, 1.25fr)",
  household: "minmax(200px, 1.45fr)",
  stage: "118px",
  groups: "minmax(140px, 1fr)",
  lastSeen: "132px",
  age: "64px",
  campus: "116px",
};

const ROW_HEIGHT: Record<"default" | "compact", number> = { default: 60, compact: 44 };

function lastSeenVisual(iso: string | null): { Icon: React.ElementType; cls: string; title: string } {
  const rel = relLastSeen(iso);
  if (rel.days === null) {
    return { Icon: Minus, cls: "text-muted-foreground", title: "No attendance recorded" };
  }
  if (rel.days < 7) return { Icon: UserCheck, cls: "text-success", title: iso ? fmtDate(iso) : "" };
  if (rel.days < 28) return { Icon: Clock, cls: "text-warning", title: iso ? fmtDate(iso) : "" };
  return { Icon: CalendarClock, cls: "text-danger", title: iso ? fmtDate(iso) : "" };
}

function SortHeader({ id, label, sortable, sort, dir, onSort }: {
  id: string; label: string; sortable: boolean; sort: string; dir: "asc" | "desc"; onSort: (id: string) => void;
}) {
  const active = sort === id;
  const Icon = !sortable ? null : active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <div role="columnheader" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className="flex min-w-0 items-center px-3">
      {sortable && Icon ? (
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            active && "text-foreground"
          )}
          onClick={() => onSort(id)}
          aria-label={`Sort by ${label}`}
        >
          <span className="truncate">{label}</span>
          <Icon className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      ) : (
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

interface CrmTableProps {
  rows: CrmPersonRow[];
  density: "default" | "compact";
  columns: CrmColumnId[];
  sort: string;
  dir: "asc" | "desc";
  totalCount: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  hasNarrowing: boolean;
  /** Phase 3: multi-select — pass a Set to enable the selection column. */
  selection?: Set<string> | null;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
  onSortChange: (id: string) => void;
  onRowOpen: (row: CrmPersonRow) => void;
  onLoadMore: () => void;
  onClearNarrowing: () => void;
  emptyAction?: React.ReactNode;
}

function CrmTableInner(props: CrmTableProps) {
  const { rows, density, columns, sort, dir, totalCount, isLoading, isFetchingNextPage, hasNextPage, error, hasNarrowing, selection } = props;
  const parentRef = useRef<HTMLDivElement>(null);
  const rowHeight = ROW_HEIGHT[density];
  const selectEnabled = selection instanceof Set;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  // Infinite scroll — fetch the next cursor page near the end of the loaded
  // set. Depends on the primitive endIndex (NOT objects): the parent is
  // React-Compiler-memoized, so object props stay referentially equal across
  // scroll re-renders and object deps would never re-trigger the effect.
  const rangeEnd = virtualizer.range?.endIndex ?? 0;
  useEffect(() => {
    if (rangeEnd === 0) return;
    if (rangeEnd >= rows.length - 14 && hasNextPage && !isFetchingNextPage) {
      props.onLoadMore();
    }
  }, [rangeEnd, rows.length, hasNextPage, isFetchingNextPage, props.onLoadMore]);

  const gridTemplate = (selectEnabled ? "44px " : "") + columns.map((c) => COLUMN_WIDTHS[c]).join(" ");
  const selectedCount = selectEnabled ? rows.reduce((n, r) => n + (selection!.has(r.id) ? 1 : 0), 0) : 0;
  const allLoadedSelected = selectEnabled && rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectEnabled && selectedCount > 0 && !allLoadedSelected;

  if (error) {
    return <ErrorBlock error={error} />;
  }

  if (!isLoading && rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState
          icon={UserX}
          title={hasNarrowing ? "No people match" : "No people yet"}
          description={
            hasNarrowing
              ? "Nothing matches the current search and filters. Try loosening them."
              : "Add your first person to get started — they'll show up here instantly."
          }
          action={
            hasNarrowing ? (
              <Button type="button" variant="outline" onClick={props.onClearNarrowing}>Clear search & filters</Button>
            ) : (
              props.emptyAction
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      {/* bounded height: the SCROLLER scrolls (not the page) so the
          virtualizer only renders visible rows and infinite-load fires
          only near the end */}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto scroll-slim max-h-[calc(100vh-320px)] min-h-[320px]"
        role="table"
        aria-label="People directory"
        aria-rowcount={rows.length + 1}
      >
        {/* sticky header */}
        <div role="rowgroup" className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
          <div role="row" className="grid min-w-[900px]" style={{ gridTemplateColumns: gridTemplate, height: 40 }}>
            {selectEnabled ? (
              <div role="columnheader" aria-label="Select people" className="flex items-center justify-center px-2">
                <Checkbox
                  checked={allLoadedSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={() => props.onToggleAll?.()}
                  aria-label={allLoadedSelected ? "Clear selection" : "Select all loaded people"}
                />
              </div>
            ) : null}
            {columns.map((c) => {
              const def = CRM_COLUMNS.find((x) => x.id === c)!;
              return (
                <SortHeader key={c} id={c} label={def.label} sortable={def.sortable} sort={sort} dir={dir} onSort={props.onSortChange} />
              );
            })}
          </div>
        </div>

        {/* virtual body */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: "900px" }}>
          {isLoading ? (
            Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="grid items-center gap-0 border-b border-border/60 px-0"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${i * rowHeight}px)`, height: rowHeight, gridTemplateColumns: gridTemplate }}
                aria-hidden
              >
                {columns.map((c) => (
                  <div key={c} className="px-3">
                    <Skeleton className={cn("h-3.5", c === "name" ? "w-3/4" : "w-2/3")} />
                  </div>
                ))}
              </div>
            ))
          ) : (
            virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              const name = `${row.firstName} ${row.lastName}`;
              const wa = waLink(row.whatsappE164 ?? row.phoneE164);
              const seen = lastSeenVisual(row.lastAttendedAt);
              const SeenIcon = seen.Icon;
              return (
                <div
                  key={row.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  role="row"
                  tabIndex={0}
                  aria-label={`Open ${name}`}
                  onClick={() => props.onRowOpen(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onRowOpen(row);
                    }
                  }}
                  className="group row-hover cursor-pointer border-b border-border/60"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                    minHeight: rowHeight,
                  }}
                >
                  <div className="grid items-center" style={{ gridTemplateColumns: gridTemplate, minHeight: rowHeight - 1 }}>
                    {selectEnabled ? (
                      <div
                        role="cell"
                        className="flex items-center justify-center px-2"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selection!.has(row.id)}
                          onCheckedChange={() => props.onToggleRow?.(row.id)}
                          aria-label={`Select ${name}`}
                        />
                      </div>
                    ) : null}
                    {columns.map((c) => {
                      switch (c) {
                        case "name":
                          return (
                            <div key={c} role="cell" className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                              <PersonAvatar name={name} src={row.photoUrl} className={cn(density === "compact" ? "h-7 w-7 text-[9px]" : "h-9 w-9 text-xs")} child={row.age != null && row.age < 13} />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {row.firstName} {row.lastName}
                                  {row.preferredName ? <span className="font-normal text-muted-foreground"> ({row.preferredName})</span> : null}
                                </p>
                                {density === "default" && row.tags.length > 0 ? (
                                  <p className="truncate text-[11px] text-muted-foreground">{row.tags.map((t) => t.name).join(" · ")}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        case "contact":
                          return (
                            <div key={c} role="cell" className="relative min-w-0 px-3 py-2 pr-16">
                              <p className="truncate text-xs">{row.email ?? (row.privacyHidden.includes("email") ? <span className="text-muted-foreground/70">Private</span> : <span className="text-muted-foreground">—</span>)}</p>
                              <p className="truncate text-xs text-muted-foreground">{row.phoneDisplay ?? (row.privacyHidden.includes("phone") ? "Private" : "")}</p>
                              <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-xs group-hover:flex group-focus-within:flex">
                                {row.phoneE164 ? (
                                  <a
                                    href={`tel:${row.phoneE164}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded p-1 text-muted-foreground transition-colors hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                    aria-label={`Call ${name}`}
                                  >
                                    <Phone className="h-3.5 w-3.5" aria-hidden />
                                  </a>
                                ) : null}
                                {wa ? (
                                  <a
                                    href={wa}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded p-1 text-muted-foreground transition-colors hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                    aria-label={`WhatsApp ${name}`}
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                                  </a>
                                ) : null}
                                {row.email ? (
                                  <a
                                    href={`mailto:${row.email}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                    aria-label={`Email ${name}`}
                                  >
                                    <Mail className="h-3.5 w-3.5" aria-hidden />
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          );
                        case "household":
                          return (
                            <div key={c} role="cell" className="flex min-w-0 items-center gap-2 px-3 py-2">
                              {row.household ? (
                                <>
                                  <div className="flex shrink-0 -space-x-1.5" aria-hidden>
                                    {row.householdMembers.slice(0, 4).map((m) => (
                                      <PersonAvatar key={m.personId} name={m.name} src={m.photoUrl} className="h-6 w-6 text-[9px]" />
                                    ))}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm">{row.household.name}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {row.householdMemberCount} member{row.householdMemberCount === 1 ? "" : "s"}
                                    </p>
                                  </div>
                                </>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </div>
                          );
                        case "stage":
                          return (
                            <div key={c} role="cell" className="min-w-0 px-3 py-2">
                              <StageBadge stage={row.lifecycleStage} />
                            </div>
                          );
                        case "groups":
                          return (
                            <div key={c} role="cell" className="flex min-w-0 flex-wrap items-center gap-1 px-3 py-2">
                              {row.groups.length === 0 ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <>
                                  {row.groups.slice(0, 2).map((g) => (
                                    <span key={g.id} className="max-w-28 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={g.name}>
                                      {g.name}
                                    </span>
                                  ))}
                                  {row.groups.length > 2 ? (
                                    <span className="text-[11px] text-muted-foreground">+{row.groups.length - 2}</span>
                                  ) : null}
                                </>
                              )}
                            </div>
                          );
                        case "lastSeen":
                          return (
                            <div key={c} role="cell" className="min-w-0 px-3 py-2">
                              <span className={cn("flex items-center gap-1.5 text-xs", seen.cls)} title={seen.title}>
                                <SeenIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span className="truncate">{relLastSeen(row.lastAttendedAt).text}</span>
                              </span>
                            </div>
                          );
                        case "age":
                          return (
                            <div key={c} role="cell" className="px-3 py-2 text-sm tabular-nums">
                              {row.age != null ? row.age : <span className="text-muted-foreground">—</span>}
                            </div>
                          );
                        case "campus":
                          return (
                            <div key={c} role="cell" className="min-w-0 px-3 py-2">
                              <span className="block truncate text-sm">{row.campusName ?? <span className="text-muted-foreground">—</span>}</span>
                            </div>
                          );
                        default:
                          return <div key={c} role="cell" className="px-3" />;
                      }
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* infinite-scroll footer */}
        {isFetchingNextPage ? (
          <div className="flex items-center justify-center gap-2 border-t py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading more…
          </div>
        ) : null}
      </div>

      {!isLoading && rows.length > 0 ? (
        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground tabular-nums">
          Showing {rows.length} of {totalCount} · {hasNextPage ? "scroll for more" : "end of list"}
        </div>
      ) : null}
    </div>
  );
}

/** Keyed by density so virtualizer measurements reset cleanly on toggle. */
export function CrmTable(props: CrmTableProps) {
  return <CrmTableInner key={props.density} {...props} />;
}
