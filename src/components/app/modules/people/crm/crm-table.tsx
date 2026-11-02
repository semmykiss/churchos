"use client";

/**
 * People CRM v2 — virtualized people table (@tanstack/react-virtual).
 * Infinite cursor paging (append), server-driven sort, sticky header, density
 * toggle, hover contact actions, household avatar stack. Rows are plain grids
 * with table roles for screen readers; all field visibility was already
 * decided by the server serializer.
 */
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, Clock, Loader2, Mail,
  MessageCircle, Minus, Phone, UserCheck, UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorBlock, PersonAvatar, StageBadge, type ModuleProps,
} from "@/components/app/shared";
import { CRM_COLUMNS, customColumnId, isCustomColumnId, relLastSeen, waLink, type CrmColumnId, type CrmPersonRow, type CustomFieldDefDTO } from "./crm-shared";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/types";

const COLUMN_WIDTHS: Record<CrmColumnId, string> = {
  // Min widths tuned so ALL default columns fit a ≥1150px content box without
  // horizontal scrolling (fr units distribute the extra space).
  name: "minmax(170px, 1.6fr)",
  contact: "minmax(150px, 1.2fr)",
  household: "minmax(160px, 1.35fr)",
  stage: "104px",
  groups: "minmax(118px, 1fr)",
  lastSeen: "112px",
  age: "72px",
  campus: "124px",
};

/** Phase 6: custom columns get a sane default width. */
function columnWidth(c: string): string {
  if (isCustomColumnId(c)) return "minmax(112px, 1fr)";
  return COLUMN_WIDTHS[c as CrmColumnId] ?? "minmax(112px, 1fr)";
}

/** Typed display for a custom field value (server already role-filtered). */
function CustomCellValue({ def, value }: { def?: CustomFieldDefDTO; value: unknown }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (def?.dataType === "boolean") {
    return <Badge variant={value ? "secondary" : "outline"} className="text-[11px] font-normal">{value ? "Yes" : "No"}</Badge>;
  }
  if (def?.dataType === "date") return <span className="tabular-nums">{fmtDate(String(value))}</span>;
  if (def?.dataType === "url") {
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="block max-w-52 truncate text-primary underline-offset-2 hover:underline"
      >
        {String(value).replace(/^https?:\/\//, "")}
      </a>
    );
  }
  if (def?.dataType === "multi_select" || Array.isArray(value)) {
    return (
      <span className="block max-w-52 truncate" title={(value as string[]).join(", ")}>
        {(value as string[]).join(", ")}
      </span>
    );
  }
  return <span className="block max-w-52 truncate" title={String(value)}>{String(value)}</span>;
}

const ROW_HEIGHT: Record<"default" | "compact", number> = { default: 52, compact: 38 };

/** Sticky left offsets for the pinned select / name columns (px). */
const SELECT_COL_W = 44;

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
    <div role="columnheader" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className="flex min-w-0 items-center px-2">
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
  /** Core ids + "custom:<key>" (Phase 6). */
  columns: string[];
  /** Phase 6: labels for custom columns + their defs for typed rendering. */
  columnLabels?: Record<string, string>;
  customDefs?: CustomFieldDefDTO[];
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

  // Track horizontal overflow so the pinned name column shows a scroll hint
  // shadow only when there is actually something hidden beneath it.
  const [hOverflow, setHOverflow] = useState(false);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => setHOverflow(el.scrollWidth > el.clientWidth + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // isLoading: the scroller mounts only after the loading skeleton swaps out
  }, [columns.length, density, isLoading]);

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

  const gridTemplate = (selectEnabled ? "44px " : "") + columns.map((c) => columnWidth(c)).join(" ");
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
          only near the end. Reserve tuned so that at full page scroll the
          table header lands exactly beneath the sticky toolbar. */}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto scroll-slim max-h-[calc(100dvh-228px)] min-h-[360px]"
        role="table"
        aria-label="People directory"
        aria-rowcount={rows.length + 1}
      >
        {/* sticky header — bg lives on the inner row so the pinned-left
            cells (bg-inherit) stay opaque over horizontally-scrolled columns */}
        <div role="rowgroup" className="sticky top-0 z-20 border-b">
          <div role="row" className="grid min-w-[640px] bg-card/95 backdrop-blur" style={{ gridTemplateColumns: gridTemplate, height: 40 }}>
            {selectEnabled ? (
              <div
                role="columnheader"
                aria-label="Select people"
                className={cn(
                  "sticky left-0 z-10 flex items-center justify-center bg-inherit px-2",
                  hOverflow && "shadow-[10px_0_10px_-10px_rgb(0_0_0/0.25)]"
                )}
              >
                <Checkbox
                  checked={allLoadedSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={() => props.onToggleAll?.()}
                  aria-label={allLoadedSelected ? "Clear selection" : "Select all loaded people"}
                />
              </div>
            ) : null}
            {columns.map((c) => {
              const def = CRM_COLUMNS.find((x) => x.id === c);
              const label = def?.label ?? props.columnLabels?.[c] ?? c.slice("custom:".length);
              const pinLeft = c === "name" && (hOverflow || selectEnabled) ? (selectEnabled ? SELECT_COL_W : 0) : null;
              return (
                <div
                  key={c}
                  className={cn(
                    "min-w-0 bg-inherit",
                    pinLeft != null && cn("sticky z-10", hOverflow && "shadow-[10px_0_10px_-10px_rgb(0_0_0/0.25)]")
                  )}
                  style={pinLeft != null ? { left: pinLeft } : undefined}
                >
                  <SortHeader id={c} label={label} sortable={def?.sortable ?? false} sort={sort} dir={dir} onSort={props.onSortChange} />
                </div>
              );
            })}
          </div>
        </div>

        {/* virtual body */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: "640px" }}>
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
              // Compact rows must actually FIT the 38px budget: stacked-line
              // cells (contact / household) tighten padding, groups stops wrapping.
              const compact = density === "compact";
              const padY = compact ? "py-1" : "py-2";
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
                  className="group row-hover cursor-pointer border-b border-border/60 bg-card"
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
                        className={cn(
                          "sticky left-0 z-10 flex h-full items-center justify-center bg-inherit px-2",
                          hOverflow && "shadow-[10px_0_10px_-10px_rgb(0_0_0/0.25)]"
                        )}
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
                            <div
                              key={c}
                              role="cell"
                              className={cn(
                                "flex h-full min-w-0 items-center gap-2 px-2.5 py-1.5",
                                (hOverflow || selectEnabled) && cn("sticky z-10 bg-inherit", hOverflow && "shadow-[10px_0_10px_-10px_rgb(0_0_0/0.25)]")
                              )}
                              style={(hOverflow || selectEnabled) ? { left: selectEnabled ? SELECT_COL_W : 0 } : undefined}
                            >
                              <PersonAvatar name={name} src={row.photoUrl} className={cn(density === "compact" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-xs")} child={row.age != null && row.age < 13} />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium leading-tight">
                                  {row.firstName} {row.lastName}
                                  {row.preferredName ? <span className="font-normal text-muted-foreground"> ({row.preferredName})</span> : null}
                                </p>
                                {density === "default" && row.tags.length > 0 ? (
                                  <p className="truncate text-[11px] leading-tight text-muted-foreground">{row.tags.map((t) => t.name).join(" · ")}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        case "contact":
                          return (
                            <div key={c} role="cell" className={cn("relative min-w-0 px-3 pr-16", padY)}>
                              <p className={cn("truncate", compact ? "text-[11px] leading-tight" : "text-xs")}>{row.email ?? (row.privacyHidden.includes("email") ? <span className="text-muted-foreground/70">Private</span> : <span className="text-muted-foreground">—</span>)}</p>
                              <p className={cn("truncate text-muted-foreground", compact ? "text-[11px] leading-tight" : "text-xs")}>{row.phoneDisplay ?? (row.privacyHidden.includes("phone") ? "Private" : "")}</p>
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
                            <div key={c} role="cell" className={cn("flex min-w-0 items-center gap-2 px-3", padY)}>
                              {row.household ? (
                                <>
                                  <div className="flex shrink-0 -space-x-1.5" aria-hidden>
                                    {row.householdMembers.slice(0, 4).map((m) => (
                                      <PersonAvatar key={m.personId} name={m.name} src={m.photoUrl} className="h-6 w-6 text-[9px]" />
                                    ))}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm leading-tight">{row.household.name}</p>
                                    <p className="text-[11px] leading-tight text-muted-foreground">
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
                            <div key={c} role="cell" className={cn("min-w-0 px-3", padY)}>
                              <StageBadge stage={row.lifecycleStage} />
                            </div>
                          );
                        case "groups":
                          return (
                            <div key={c} role="cell" className={cn("flex min-w-0 items-center gap-1 overflow-hidden px-3", padY, !compact && "flex-wrap")}>
                              {row.groups.length === 0 ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : (
                                <>
                                  {row.groups.slice(0, compact ? 1 : 2).map((g) => (
                                    <span key={g.id} className="max-w-28 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={g.name}>
                                      {g.name}
                                    </span>
                                  ))}
                                  {row.groups.length > (compact ? 1 : 2) ? (
                                    <span className="shrink-0 text-[11px] text-muted-foreground">+{row.groups.length - (compact ? 1 : 2)}</span>
                                  ) : null}
                                </>
                              )}
                            </div>
                          );
                        case "lastSeen":
                          return (
                            <div key={c} role="cell" className={cn("min-w-0 px-3", padY)}>
                              <span className={cn("flex items-center gap-1.5 text-xs", seen.cls)} title={seen.title}>
                                <SeenIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span className="truncate">{relLastSeen(row.lastAttendedAt).text}</span>
                              </span>
                            </div>
                          );
                        case "age":
                          return (
                            <div key={c} role="cell" className={cn("px-3 text-sm tabular-nums", padY)}>
                              {row.age != null ? row.age : <span className="text-muted-foreground">—</span>}
                            </div>
                          );
                        case "campus":
                          return (
                            <div key={c} role="cell" className={cn("min-w-0 px-3", padY)}>
                              <span className="block truncate text-sm" title={row.campusName ?? undefined}>{row.campusName ?? <span className="text-muted-foreground">—</span>}</span>
                            </div>
                          );
                        default: {
                          // People CRM (Phase 6): custom field columns
                          if (isCustomColumnId(c)) {
                            const def = props.customDefs?.find((d) => customColumnId(d.key) === c);
                            return (
                              <div key={c} role="cell" className={cn("min-w-0 px-3 text-sm", padY)}>
                                <CustomCellValue def={def} value={row.custom?.[c.slice("custom:".length)]} />
                              </div>
                            );
                          }
                          return <div key={c} role="cell" className="px-3" />;
                        }
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
