"use client";

/**
 * People CRM v2 — Board view (Phase 3): Kanban columns by lifecycle stage.
 *
 * Drag & drop goes through the EXISTING stage-change mutation
 * (POST /people/:id/stage — which also writes stage history); the parent
 * applies the optimistic cache update and rolls back on ApiError. No new
 * write path exists. Keyboard users get an equivalent "Move to stage" menu
 * on every card (WCAG — drag is never the only path), and dragging is
 * disabled entirely when the viewer lacks people.edit (read-only board).
 */
import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, GripVertical, Inbox, Loader2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar, StageBadge } from "@/components/app/shared";
import { STAGE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { CrmPersonRow } from "./crm-shared";

/** Board columns — archived rows never reach the v2 list by default. */
const BOARD_STAGES = ["guest", "returning_guest", "attender", "member", "leader", "inactive"] as const;

interface CrmBoardProps {
  rows: CrmPersonRow[];
  /** Server-computed per-stage totals over the same scoped where. */
  stageCounts?: Record<string, number>;
  /** Viewer holds people.edit — dragging + the move menu are enabled only then. */
  canDrag: boolean;
  isLoading: boolean;
  totalCount: number;
  /** Parent: optimistic update + POST /people/:id/stage + rollback on error. */
  onMovePerson: (personId: string, fromStage: string, toStage: string) => void;
  isMoving: boolean;
  onRowOpen: (row: CrmPersonRow) => void;
}

function BoardCard({ row, canDrag, onRowOpen, onMove, dragging }: {
  row: CrmPersonRow;
  canDrag: boolean;
  onRowOpen: (row: CrmPersonRow) => void;
  onMove: (toStage: string) => void;
  dragging?: boolean;
}) {
  const name = `${row.firstName} ${row.lastName}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
    data: { stage: row.lifecycleStage },
    disabled: !canDrag,
  });
  const otherStages = BOARD_STAGES.filter((s) => s !== row.lifecycleStage);

  return (
    <div
      ref={setNodeRef}
      role="listitem"
      aria-label={`${name} — ${STAGE_LABELS[row.lifecycleStage] ?? row.lifecycleStage}`}
      className={cn(
        "group relative rounded-lg border bg-card p-2.5 shadow-xs transition-shadow",
        canDrag && "cursor-grab active:cursor-grabbing hover:shadow-sm",
        (isDragging || dragging) && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {canDrag ? (
          <button
            type="button"
            className="mt-0.5 touch-none rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={`Drag ${name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onRowOpen(row)}
          aria-label={`Open ${name}`}
        >
          <PersonAvatar name={name} src={row.photoUrl} className="h-8 w-8 shrink-0 text-[10px]" child={row.age != null && row.age < 13} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">
              {row.firstName} {row.lastName}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {row.household?.name ?? "No household"}
            </span>
          </span>
        </button>
        {canDrag ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                aria-label={`Move ${name} to another stage`}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Move to stage</DropdownMenuLabel>
              {otherStages.map((s) => (
                <DropdownMenuItem key={s} onClick={() => onMove(s)}>
                  {STAGE_LABELS[s] ?? s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

function BoardColumn({ stage, rows, count, canDrag, onRowOpen, onMove }: {
  stage: string;
  rows: CrmPersonRow[];
  count: number;
  canDrag: boolean;
  onRowOpen: (row: CrmPersonRow) => void;
  onMove: (personId: string, fromStage: string, toStage: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div className="flex min-h-0 w-64 shrink-0 flex-col rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.05em] text-ink-muted">
          <StageBadge stage={stage} />
        </h3>
        <span className="rounded-full bg-background px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground" aria-label={`${count} people in ${STAGE_LABELS[stage] ?? stage}`}>
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        role="list"
        aria-label={`${STAGE_LABELS[stage] ?? stage} column`}
        className={cn(
          "min-h-24 flex-1 space-y-2 overflow-y-auto scroll-slim p-2",
          isOver && canDrag && "bg-primary/5 ring-2 ring-inset ring-primary/40",
        )}
      >
        {rows.length === 0 ? (
          <p className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-6 text-[11px] text-muted-foreground">
            <Inbox className="h-3.5 w-3.5" aria-hidden /> Empty
          </p>
        ) : (
          rows.map((row) => (
            <BoardCard
              key={row.id}
              row={row}
              canDrag={canDrag}
              onRowOpen={onRowOpen}
              onMove={(to) => onMove(row.id, row.lifecycleStage, to)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function CrmBoard({ rows, stageCounts, canDrag, isLoading, totalCount, onMovePerson, isMoving, onRowOpen }: CrmBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // 6px activation keeps plain clicks on cards working (opens the drawer)
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byStage = new Map<string, CrmPersonRow[]>();
  for (const s of BOARD_STAGES) byStage.set(s, []);
  for (const r of rows) {
    if (byStage.has(r.lifecycleStage)) byStage.get(r.lifecycleStage)!.push(r);
  }
  const loadedCount = (s: string) => byStage.get(s)?.length ?? 0;
  const headerCount = (s: string) => stageCounts?.[s] ?? loadedCount(s);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const personId = String(e.active.id);
    const fromStage = (e.active.data.current as { stage?: string } | undefined)?.stage;
    const toStage = e.over ? String(e.over.id) : null;
    if (!fromStage || !toStage || fromStage === toStage) return;
    onMovePerson(personId, fromStage, toStage);
  };

  const activeRow = activeId ? rows.find((r) => r.id === activeId) ?? null : null;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {!canDrag ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground" role="note">
          Read-only board — moving people between stages needs edit rights.
        </p>
      ) : null}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 gap-3 overflow-x-auto scroll-slim pb-2" style={{ minHeight: 340 }}>
          {BOARD_STAGES.map((s) => (
            <BoardColumn
              key={s}
              stage={s}
              rows={byStage.get(s) ?? []}
              count={headerCount(s)}
              canDrag={canDrag}
              onRowOpen={onRowOpen}
              onMove={onMovePerson}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <div className="w-56 rotate-1 rounded-lg border bg-card p-2.5 shadow-lg">
              <div className="flex items-center gap-2">
                <PersonAvatar
                  name={`${activeRow.firstName} ${activeRow.lastName}`}
                  src={activeRow.photoUrl}
                  className="h-8 w-8 text-[10px]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{activeRow.firstName} {activeRow.lastName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{activeRow.household?.name ?? "No household"}</span>
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground tabular-nums">
        {isMoving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
        Showing {rows.length} of {totalCount} matching · board is capped at 600 cards — narrow with a smart list or search for more
      </div>
      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {BOARD_STAGES.slice(0, 4).map((s) => (
            <div key={s} className="w-64 shrink-0 space-y-2 rounded-xl border bg-muted/40 p-2" aria-hidden>
              <Skeleton className="h-6 w-24" />
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
