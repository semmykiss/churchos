"use client";

/* eslint-disable react-hooks/refs --
 * TanStack Virtual's canonical measurement pattern: `virtualizer.measureElement`
 * is a ref CALLBACK (it attaches the ResizeObserver used for row measurement)
 * handed down to the memoized <PersonRow>. The React Compiler cannot trace the
 * prop through the memo boundary, so it flags every attribute of the row JSX.
 * The ref is only ATTACHED here — never read or written during render — so the
 * rule is suppressed for this file only. Same pattern as the previous inline
 * `ref={virtualizer.measureElement}` version of this table.
 */

/**
 * People CRM v2 — virtualized people table (@tanstack/react-virtual).
 *
 * Layout rules (single source of truth = COLS below):
 *  - every header cell and body cell uses the same horizontal padding (CELL_X)
 *  - header cells are flex + h-full + items-center, sortable or not, so baselines match
 *  - numeric columns declare align:"end" and are right-aligned in header AND cell
 *  - select / name / actions columns are pinned with solid backgrounds
 *  - the row element IS the grid (valid table > row > cell ARIA tree)
 *
 * Optional CSS var: --people-table-offset (px) = space above/below the table
 * inside the viewport. Defaults to 228px.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Copy, Loader2, Lock, Mail, MapPin,
  MessageCircle, MoreHorizontal, Phone, UserRound, UserX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorBlock, PersonAvatar, StageBadge } from "@/components/app/shared";
import {
  CRM_COLUMNS, customColumnId, isCustomColumnId, relLastSeen, waLink,
  type CrmColumnId, type CrmPersonRow, type CustomFieldDefDTO,
} from "./crm-shared";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/types";

/* ───────────────────────── layout constants ───────────────────────── */

const SELECT_W = 44;
const ACTIONS_W = 52;
const HEADER_H = 40;
const ROW_H = { default: 60, compact: 44 } as const;
/** Same horizontal padding for EVERY header and body cell. */
const CELL_X = "px-4";

const SHADOW_L = "shadow-[8px_0_8px_-8px_rgb(0_0_0/0.2)]";
const SHADOW_R = "shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.2)]";

interface ColSpec {
  /** Minimum width in px. */
  min: number;
  /** Flex share of the remaining space; omit for a fixed-width column. */
  fr?: number;
  align?: "end";
}

/** ONE definition of width + alignment, used by header, body and skeleton. */
const COLS: Record<CrmColumnId, ColSpec> = {
  name: { min: 220, fr: 1.6 },
  contact: { min: 230, fr: 1.4 },
  household: { min: 170, fr: 1.1 },
  stage: { min: 124 },
  groups: { min: 150, fr: 1 },
  lastSeen: { min: 128 },
  age: { min: 72, align: "end" },
  campus: { min: 150, fr: 1 },
};
const CUSTOM_COL: ColSpec = { min: 140, fr: 1 };

function specFor(c: string): ColSpec {
  if (isCustomColumnId(c)) return CUSTOM_COL;
  return COLS[c as CrmColumnId] ?? CUSTOM_COL;
}
const track = (s: ColSpec) => (s.fr ? `minmax(${s.min}px, ${s.fr}fr)` : `${s.min}px`);

/* ───────────────────────── small helpers ───────────────────────── */

/** Empty cells stay visually blank (no repeated dashes) but readable by AT. */
function EmptyCell() {
  return <span className="sr-only">None</span>;
}

function PrivateTag() {
  return (
    <span className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
      <Lock className="h-3 w-3" aria-hidden /> Private
    </span>
  );
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}

function CustomCellValue({ def, value }: { def?: CustomFieldDefDTO; value: unknown }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <EmptyCell />;
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
        className="block max-w-full truncate text-primary underline-offset-2 hover:underline"
      >
        {String(value).replace(/^https?:\/\//, "")}
      </a>
    );
  }
  const text = (Array.isArray(value) ? value : [value]).map(String).join(", ");
  return <span className="block max-w-full truncate" title={text}>{text}</span>;
}

/** Recency dot + relative text. "Never" is muted italic, no stray dash. */
function LastSeen({ iso }: { iso: string | null }) {
  const rel = relLastSeen(iso);
  if (rel.days === null) {
    return <span className="text-[13px] italic text-muted-foreground" title="No attendance recorded">Never</span>;
  }
  const tone =
    rel.days < 7 ? { dot: "bg-success", label: "Recently active" }
    : rel.days < 28 ? { dot: "bg-warning", label: "Drifting" }
    : { dot: "bg-danger", label: "Inactive" };
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground" title={iso ? fmtDate(iso) : undefined}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
      <span className="truncate">{rel.text}</span>
      <span className="sr-only">({tone.label})</span>
    </span>
  );
}

/* ───────────────────────── header cell ───────────────────────── */

interface HeadCellProps {
  id: string;
  label: string;
  sortable: boolean;
  align?: "end";
  sort: string;
  dir: "asc" | "desc";
  onSort: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

function HeadCell({ id, label, sortable, align, sort, dir, onSort, className, style }: HeadCellProps) {
  const active = sortable && sort === id;
  const Icon = !sortable ? null : active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const labelCls = "truncate text-[11px] font-semibold uppercase tracking-wider";
  return (
    <div
      role="columnheader"
      aria-sort={sortable ? (active ? (dir === "asc" ? "ascending" : "descending") : "none") : undefined}
      // identical flex/height/padding for sortable and plain headers → same baseline
      className={cn("flex h-full min-w-0 items-center", CELL_X, align === "end" && "justify-end", className)}
      style={style}
    >
      {sortable && Icon ? (
        <button
          type="button"
          onClick={() => onSort(id)}
          aria-label={`Sort by ${label}`}
          // -mx-2 + px-2: hover pill extends outward but the TEXT stays on the cell padding line
          className={cn(
            "group/sort -mx-2 inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors",
            "hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            active && "text-foreground"
          )}
        >
          <span className={labelCls}>{label}</span>
          {/* icon slot is ALWAYS rendered so labels never shift when sorting */}
          <Icon
            className={cn("h-3 w-3 shrink-0 transition-opacity", active ? "opacity-100" : "opacity-40 group-hover/sort:opacity-100")}
            aria-hidden
          />
        </button>
      ) : (
        <span className={cn(labelCls, "text-muted-foreground")}>{label}</span>
      )}
    </div>
  );
}

/* ───────────────────────── row actions menu ───────────────────────── */

function RowMenu({ row, name, wa, onOpen }: {
  row: CrmPersonRow; name: string; wa: string | null; onOpen: (row: CrmPersonRow) => void;
}) {
  const phone = row.phoneDisplay ?? row.phoneE164;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${name}`}
          className={cn(
            "h-8 w-8 text-muted-foreground transition-opacity",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
            "[@media(hover:none)]:opacity-100"
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* portal events still bubble through React — stop them reaching the row */}
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onOpen(row)}>
          <UserRound className="mr-2 h-3.5 w-3.5" aria-hidden /> View profile
        </DropdownMenuItem>
        {row.phoneE164 || wa || row.email ? <DropdownMenuSeparator /> : null}
        {row.phoneE164 ? (
          <DropdownMenuItem asChild>
            <a href={`tel:${row.phoneE164}`}><Phone className="mr-2 h-3.5 w-3.5" aria-hidden /> Call</a>
          </DropdownMenuItem>
        ) : null}
        {wa ? (
          <DropdownMenuItem asChild>
            <a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-3.5 w-3.5" aria-hidden /> WhatsApp</a>
          </DropdownMenuItem>
        ) : null}
        {row.email ? (
          <DropdownMenuItem asChild>
            <a href={`mailto:${row.email}`}><Mail className="mr-2 h-3.5 w-3.5" aria-hidden /> Email</a>
          </DropdownMenuItem>
        ) : null}
        {row.email || phone ? <DropdownMenuSeparator /> : null}
        {row.email ? (
          <DropdownMenuItem onSelect={() => void copyText(row.email!, "Email")}>
            <Copy className="mr-2 h-3.5 w-3.5" aria-hidden /> Copy email
          </DropdownMenuItem>
        ) : null}
        {phone ? (
          <DropdownMenuItem onSelect={() => void copyText(phone, "Phone number")}>
            <Copy className="mr-2 h-3.5 w-3.5" aria-hidden /> Copy phone
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ───────────────────────── body row ───────────────────────── */

interface RowViewProps {
  row: CrmPersonRow;
  index: number;
  start: number;
  columns: string[];
  gridTemplate: string;
  rowHeight: number;
  compact: boolean;
  selectEnabled: boolean;
  selected: boolean;
  anySelected: boolean;
  nameLeft: number;
  edgeLeft: boolean;
  edgeRight: boolean;
  customDefs?: CustomFieldDefDTO[];
  measureElement: (el: Element | null) => void;
  onOpen: (row: CrmPersonRow) => void;
  onToggle?: (id: string) => void;
  onNavigate: (index: number, delta: number) => void;
}

const PersonRow = memo(function PersonRow(p: RowViewProps) {
  const { row, compact } = p;
  const name = `${row.firstName} ${row.lastName}`;
  const wa = waLink(row.whatsappE164 ?? row.phoneE164);
  const padY = compact ? "py-1" : "py-2";
  const maxChips = compact ? 1 : 2;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // ignore keys that originate in the checkbox / menus inside the row
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        p.onOpen(row);
        break;
      case " ":
        e.preventDefault();
        if (p.selectEnabled) p.onToggle?.(row.id);
        else p.onOpen(row);
        break;
      case "ArrowDown":
        e.preventDefault();
        p.onNavigate(p.index, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        p.onNavigate(p.index, -1);
        break;
    }
  };

  const emailPrivate = !row.email && row.privacyHidden.includes("email");
  const phonePrivate = !row.phoneDisplay && row.privacyHidden.includes("phone");
  const hasContact = Boolean(row.email || row.phoneDisplay || emailPrivate || phonePrivate);
  const stack = "flex min-w-0 flex-col justify-center";
  const quickBtn =
    "rounded p-1 text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <div
      ref={p.measureElement}
      data-index={p.index}
      role="row"
      tabIndex={0}
      aria-rowindex={p.index + 2}
      aria-selected={p.selectEnabled ? p.selected : undefined}
      aria-label={`Open ${name}`}
      onClick={() => p.onOpen(row)}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute left-0 top-0 grid w-full cursor-pointer items-center border-b border-border/50 text-[13px] outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        p.selected
          ? "bg-blue-50 before:absolute before:inset-y-0 before:left-0 before:z-20 before:w-0.5 before:bg-primary before:content-[''] dark:bg-blue-950"
          : "bg-card hover:bg-slate-50 dark:hover:bg-slate-900"
      )}
      style={{ transform: `translateY(${p.start}px)`, minHeight: p.rowHeight, gridTemplateColumns: p.gridTemplate }}
    >
      {p.selectEnabled ? (
        <div
          role="cell"
          className="sticky left-0 z-10 flex h-full items-center justify-center bg-inherit"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={p.selected}
            onCheckedChange={() => p.onToggle?.(row.id)}
            aria-label={`Select ${name}`}
            className={cn(
              "transition-opacity",
              p.selected || p.anySelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
            )}
          />
        </div>
      ) : null}

      {p.columns.map((c) => {
        switch (c) {
          case "name":
            return (
              <div
                key={c}
                role="cell"
                className={cn("sticky z-10 flex h-full min-w-0 items-center gap-3 bg-inherit", CELL_X, p.edgeLeft && SHADOW_L)}
                style={{ left: p.nameLeft }}
              >
                <PersonAvatar
                  name={name}
                  src={row.photoUrl}
                  child={row.age != null && row.age < 13}
                  className={cn("shrink-0", compact ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-[11px]")}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-tight text-foreground" title={name}>
                    {row.firstName} {row.lastName}
                    {row.preferredName ? <span className="font-normal text-muted-foreground"> ({row.preferredName})</span> : null}
                  </p>
                  {!compact && row.tags.length > 0 ? (
                    <p className="mt-0.5 truncate text-[12px] leading-tight text-muted-foreground">
                      {row.tags.map((t) => t.name).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            );

          case "contact":
            return (
              <div key={c} role="cell" className={cn("relative", stack, CELL_X, padY)}>
                {hasContact ? (
                  <>
                    {row.email ? (
                      <p className={cn("truncate text-foreground", compact ? "text-[11px] leading-tight" : "text-[13px] leading-snug")} title={row.email}>
                        {row.email}
                      </p>
                    ) : emailPrivate ? <PrivateTag /> : null}
                    {row.phoneDisplay ? (
                      <p className={cn("truncate tabular-nums text-muted-foreground", compact ? "text-[11px] leading-tight" : "text-xs leading-snug")}>
                        {row.phoneDisplay}
                      </p>
                    ) : phonePrivate ? <PrivateTag /> : null}
                  </>
                ) : <EmptyCell />}
                {/* quick actions overlay on hover — no permanently reserved padding */}
                <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-xs group-hover:flex group-focus-within:flex">
                  {row.phoneE164 ? (
                    <a href={`tel:${row.phoneE164}`} onClick={(e) => e.stopPropagation()} className={cn(quickBtn, "hover:text-success")} aria-label={`Call ${name}`}>
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                  {wa ? (
                    <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cn(quickBtn, "hover:text-success")} aria-label={`WhatsApp ${name}`}>
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                  {row.email ? (
                    <a href={`mailto:${row.email}`} onClick={(e) => e.stopPropagation()} className={cn(quickBtn, "hover:text-primary")} aria-label={`Email ${name}`}>
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                </div>
              </div>
            );

          case "household":
            return (
              <div key={c} role="cell" className={cn("flex min-w-0 items-center gap-2.5", CELL_X, padY)}>
                {row.household ? (
                  <>
                    <div className="flex shrink-0 -space-x-1.5" aria-hidden>
                      {row.householdMembers.slice(0, 3).map((m) => (
                        <PersonAvatar key={m.personId} name={m.name} src={m.photoUrl} className="h-6 w-6 shrink-0 text-[9px] ring-2 ring-card" />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate leading-tight text-foreground" title={row.household.name}>{row.household.name}</p>
                      <p className="text-[11px] leading-tight text-muted-foreground">
                        {row.householdMemberCount} member{row.householdMemberCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </>
                ) : <EmptyCell />}
              </div>
            );

          case "stage":
            return (
              <div key={c} role="cell" className={cn("min-w-0", CELL_X, padY)}>
                <StageBadge stage={row.lifecycleStage} />
              </div>
            );

          case "groups":
            return (
              <div key={c} role="cell" className={cn("flex min-w-0 items-center gap-1 overflow-hidden", CELL_X, padY)}>
                {row.groups.length === 0 ? <EmptyCell /> : (
                  <>
                    {row.groups.slice(0, maxChips).map((g) => (
                      <span key={g.id} title={g.name} className="max-w-28 shrink-0 truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {g.name}
                      </span>
                    ))}
                    {row.groups.length > maxChips ? (
                      <span
                        className="shrink-0 text-[11px] font-medium text-muted-foreground"
                        title={row.groups.slice(maxChips).map((g) => g.name).join(", ")}
                      >
                        +{row.groups.length - maxChips}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            );

          case "lastSeen":
            return (
              <div key={c} role="cell" className={cn("min-w-0", CELL_X, padY)}>
                <LastSeen iso={row.lastAttendedAt} />
              </div>
            );

          case "age":
            return (
              <div key={c} role="cell" className={cn("flex justify-end tabular-nums text-muted-foreground", CELL_X, padY)}>
                {row.age != null ? row.age : <EmptyCell />}
              </div>
            );

          case "campus":
            return (
              <div key={c} role="cell" className={cn("flex min-w-0 items-center gap-1.5 text-muted-foreground", CELL_X, padY)}>
                {row.campusName ? (
                  <>
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate" title={row.campusName}>{row.campusName}</span>
                  </>
                ) : <EmptyCell />}
              </div>
            );

          default: {
            if (isCustomColumnId(c)) {
              const def = p.customDefs?.find((d) => customColumnId(d.key) === c);
              return (
                <div key={c} role="cell" className={cn("min-w-0", CELL_X, padY)}>
                  <CustomCellValue def={def} value={row.custom?.[c.slice("custom:".length)]} />
                </div>
              );
            }
            return <div key={c} role="cell" className={CELL_X} />;
          }
        }
      })}

      {/* pinned actions column */}
      <div
        role="cell"
        className={cn("sticky right-0 z-10 flex h-full items-center justify-center bg-inherit", p.edgeRight && SHADOW_R)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <RowMenu row={row} name={name} wa={wa} onOpen={p.onOpen} />
      </div>
    </div>
  );
});

/* ───────────────────────── table ───────────────────────── */

interface CrmTableProps {
  rows: CrmPersonRow[];
  density: "default" | "compact";
  /** Core ids + "custom:<key>" (Phase 6). */
  columns: string[];
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
  const {
    rows, density, columns, sort, dir, totalCount, isLoading, isFetchingNextPage,
    hasNextPage, error, hasNarrowing, selection, onLoadMore,
  } = props;

  const parentRef = useRef<HTMLDivElement>(null);
  const rowHeight = ROW_H[density];
  const compact = density === "compact";
  const selectEnabled = selection instanceof Set;
  const showTable = !error && (isLoading || rows.length > 0);

  /* scroll edges → pinned-column shadows + header shadow, only when meaningful */
  const [edges, setEdges] = useState({ left: false, right: false, top: false });
  const updateEdges = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const next = {
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      top: el.scrollTop > 0,
    };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right && prev.top === next.top ? prev : next));
  }, []);
  useEffect(() => {
    if (!showTable) return;
    const el = parentRef.current;
    if (!el) return;
    updateEdges();
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTable, columns.length, density, updateEdges]);

  /* grid template + min width derived from the single COLS source */
  const { gridTemplate, minWidth } = useMemo(() => {
    const specs = columns.map(specFor);
    const tracks = [
      ...(selectEnabled ? [`${SELECT_W}px`] : []),
      ...specs.map(track),
      `${ACTIONS_W}px`,
    ];
    return {
      gridTemplate: tracks.join(" "),
      minWidth: (selectEnabled ? SELECT_W : 0) + ACTIONS_W + specs.reduce((n, s) => n + s.min, 0),
    };
  }, [columns, selectEnabled]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    scrollPaddingStart: HEADER_H, // keyboard navigation never hides a row under the sticky header
  });

  // Infinite scroll — primitive endIndex dep (see original note re: React Compiler).
  const rangeEnd = virtualizer.range?.endIndex ?? 0;
  useEffect(() => {
    if (rangeEnd === 0) return;
    if (rangeEnd >= rows.length - 14 && hasNextPage && !isFetchingNextPage) onLoadMore();
  }, [rangeEnd, rows.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  const onNavigate = useCallback((index: number, delta: number) => {
    const next = Math.min(rows.length - 1, Math.max(0, index + delta));
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() => {
      parentRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
    });
  }, [rows.length, virtualizer]);

  const selectedCount = selectEnabled ? rows.reduce((n, r) => n + (selection!.has(r.id) ? 1 : 0), 0) : 0;
  const allLoadedSelected = selectEnabled && rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectEnabled && selectedCount > 0 && !allLoadedSelected;
  const nameLeft = selectEnabled ? SELECT_W : 0;

  if (error) return <ErrorBlock error={error} />;

  if (!isLoading && rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card shadow-xs">
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
            ) : props.emptyAction
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <div
          ref={parentRef}
          onScroll={updateEdges}
          role="table"
          aria-label="People directory"
          aria-rowcount={Math.max(totalCount, rows.length) + 1}
          aria-busy={isLoading}
          className="scroll-slim relative min-h-[360px] flex-1 overflow-auto max-h-[calc(100dvh-var(--people-table-offset,228px))]"
        >
          {/* ── sticky header: SOLID background so pinned cells never show scrolled content ── */}
          <div
            role="rowgroup"
            className={cn(
              "sticky top-0 z-20 border-b bg-slate-50 transition-shadow dark:bg-slate-900",
              edges.top && "shadow-[0_6px_8px_-6px_rgb(0_0_0/0.15)]"
            )}
            style={{ minWidth }}
          >
            <div role="row" aria-rowindex={1} className="grid" style={{ gridTemplateColumns: gridTemplate, height: HEADER_H }}>
              {selectEnabled ? (
                <div role="columnheader" aria-label="Select people" className="sticky left-0 z-10 flex h-full items-center justify-center bg-inherit">
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
                const isName = c === "name";
                return (
                  <HeadCell
                    key={c}
                    id={c}
                    label={label}
                    sortable={def?.sortable ?? false}
                    align={specFor(c).align}
                    sort={sort}
                    dir={dir}
                    onSort={props.onSortChange}
                    className={isName ? cn("sticky z-10 bg-inherit", edges.left && SHADOW_L) : undefined}
                    style={isName ? { left: nameLeft } : undefined}
                  />
                );
              })}
              <div role="columnheader" aria-label="Actions" className={cn("sticky right-0 z-10 bg-inherit", edges.right && SHADOW_R)} />
            </div>
          </div>

          {/* ── body ── */}
          {isLoading ? (
            <div role="rowgroup" style={{ minWidth }}>
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  role="row"
                  aria-hidden
                  className="grid items-center border-b border-border/50"
                  style={{ gridTemplateColumns: gridTemplate, height: rowHeight }}
                >
                  {selectEnabled ? <div /> : null}
                  {columns.map((c) => (
                    <div key={c} className={cn("flex items-center gap-3", CELL_X)}>
                      {c === "name" ? (
                        <>
                          <Skeleton className={cn("shrink-0 rounded-full", compact ? "h-7 w-7" : "h-9 w-9")} />
                          <div className="w-full space-y-1.5">
                            <Skeleton className="h-3.5 w-3/4" />
                            {!compact ? <Skeleton className="h-3 w-1/2" /> : null}
                          </div>
                        </>
                      ) : (
                        <Skeleton className={cn("h-3.5", c === "stage" ? "h-5 w-16 rounded-full" : "w-2/3")} />
                      )}
                    </div>
                  ))}
                  <div />
                </div>
              ))}
            </div>
          ) : (
            <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), minWidth, position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = rows[vi.index];
                return (
                  <PersonRow
                    key={row.id}
                    row={row}
                    index={vi.index}
                    start={vi.start}
                    columns={columns}
                    gridTemplate={gridTemplate}
                    rowHeight={rowHeight}
                    compact={compact}
                    selectEnabled={selectEnabled}
                    selected={selectEnabled && selection!.has(row.id)}
                    anySelected={selectedCount > 0}
                    nameLeft={nameLeft}
                    edgeLeft={edges.left}
                    edgeRight={edges.right}
                    customDefs={props.customDefs}
                    measureElement={virtualizer.measureElement}
                    onOpen={props.onRowOpen}
                    onToggle={props.onToggleRow}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          )}

          {isFetchingNextPage ? (
            <div className="flex items-center justify-center gap-2 border-t py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading more…
            </div>
          ) : null}
        </div>

        {/* ── footer (outside the scroller, so it can never be clipped) ── */}
        {!isLoading ? (
          <div className="flex items-center justify-between gap-3 border-t bg-card px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
            <span aria-live="polite">
              Showing 1–{rows.length} of {totalCount}
              {selectedCount > 0 ? <span className="ml-2 font-medium text-foreground">· {selectedCount} selected</span> : null}
            </span>
            {hasNextPage ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onLoadMore} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <span>End of list</span>
            )}
          </div>
        ) : null}
      </div>

      {/* keeps the floating AI button / bulk bar from covering the last rows */}
      <div aria-hidden className="h-20 shrink-0" />
    </>
  );
}

/** Keyed by density so virtualizer measurements reset cleanly on toggle. */
export function CrmTable(props: CrmTableProps) {
  return <CrmTableInner key={props.density} {...props} />;
}