"use client";

/**
 * Kanban board — one column per active pipeline stage. Leadership drags cards
 * between stages (native HTML5 DnD, optimistic with revert); anyone with
 * pipeline.view can click a card to open the person's journey.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorBlock, useApiQuery, type ModuleProps } from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Columns3 } from "lucide-react";
import JourneyDialog from "./JourneyDialog";
import { errMessage, stageDotClass, type BoardCard, type BoardResp } from "./pipeline-shared";

export default function KanbanBoardTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const boardQ = useApiQuery<BoardResp>(["pipeline", "board"], "/pipeline/board");
  const [journeyId, setJourneyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ personId: string; name: string; fromStageId: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // same privilege trio the server accepts for manual moves — DnD is UI sugar
  const canMove = canDo(user, "pipeline.manage") || canDo(user, "people.edit") || canDo(user, "pipeline.tasks.all");

  const columns = boardQ.data?.columns ?? [];
  const totalPeople = columns.reduce((n, c) => n + c.cards.length, 0);

  /** Move the card locally so the drop feels instant; refetch reconciles. */
  function optimisticMove(personId: string, fromStageId: string, toStageId: string) {
    const prev = qc.getQueryData<BoardResp>(["pipeline", "board"]);
    if (!prev) return;
    const card = prev.columns.find((c) => c.id === fromStageId)?.cards.find((k) => k.personId === personId);
    if (!card) return;
    const next: BoardResp = {
      columns: prev.columns.map((c) => {
        if (c.id === fromStageId) {
          const cards = c.cards.filter((k) => k.personId !== personId);
          return { ...c, cards, stalledCount: cards.filter((k) => k.stalled).length };
        }
        if (c.id === toStageId) {
          const cards = [...c.cards, card];
          return { ...c, cards, stalledCount: cards.filter((k) => k.stalled).length };
        }
        return c;
      }),
    };
    qc.setQueryData(["pipeline", "board"], next);
  }

  async function drop(toStageId: string) {
    const drag = dragging;
    setDragging(null);
    setDragOverId(null);
    if (!drag || drag.fromStageId === toStageId) return;
    const targetName = columns.find((c) => c.id === toStageId)?.name ?? "the next stage";
    optimisticMove(drag.personId, drag.fromStageId, toStageId);
    try {
      await api.post("/pipeline/move", { personId: drag.personId, toStageId });
      toast.success(`${drag.name} moved to ${targetName}.`);
    } catch (err) {
      // volunteers get a 403 here — surface the server message and let the refetch revert
      toast.error(errMessage(err));
    } finally {
      await qc.invalidateQueries({ queryKey: ["pipeline"] });
    }
  }

  if (boardQ.isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-[270px] shrink-0 space-y-2 rounded-xl border bg-muted/20 p-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }
  if (boardQ.isError) {
    return <ErrorBlock error={boardQ.error} />;
  }
  if (columns.length === 0) {
    return (
      <EmptyState
        icon={Columns3}
        title="No one in the pipeline yet"
        description="Open a person in the People module and use “Move to next stage”, or configure stages in Settings."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {totalPeople} {totalPeople === 1 ? "person" : "people"} on the board ·{" "}
        {canMove ? "drag a card to another stage, or click it to see the journey." : "click a card to see the journey."}
      </p>

      <div
        className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3 scroll-slim"
        role="list"
        aria-label="Pipeline stages"
      >
        {columns.map((col) => (
          <div
            key={col.id}
            role="listitem"
            aria-label={`${col.name} stage, ${col.cards.length} people`}
            className={cn(
              "flex w-[270px] shrink-0 flex-col rounded-xl border bg-muted/20",
              dragging && dragOverId === col.id && "ring-2 ring-primary/40",
            )}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverId(col.id);
            }}
            onDragLeave={() => setDragOverId((id) => (id === col.id ? null : id))}
            onDrop={(e) => {
              e.preventDefault();
              void drop(col.id);
            }}
          >
            {/* column header */}
            <div className="border-b p-3">
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", stageDotClass(col.color))} aria-hidden />
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{col.name}</h3>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {col.cards.length}
                </Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {col.stalledCount > 0 ? (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  >
                    {col.stalledCount} stalled
                  </Badge>
                ) : null}
                <span className="text-[11px] text-muted-foreground">stalls after {col.stallThresholdDays}d</span>
              </div>
            </div>

            {/* cards / drop zone */}
            <div className="flex min-h-[88px] flex-1 flex-col gap-2 p-2">
              {col.cards.length === 0 ? (
                <div
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground",
                    dragging && dragOverId === col.id && "border-primary/50 bg-primary/5 text-foreground",
                  )}
                >
                  {dragging ? "Drop here" : "Empty stage"}
                </div>
              ) : (
                col.cards.map((card) => (
                  <BoardCardRow
                    key={card.personId}
                    card={card}
                    draggable={canMove}
                    dimmed={dragging?.personId === card.personId}
                    onDragStart={() => setDragging({ personId: card.personId, name: card.name, fromStageId: col.id })}
                    onDragEnd={() => {
                      setDragging(null);
                      setDragOverId(null);
                    }}
                    onOpenJourney={() => setJourneyId(card.personId)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <JourneyDialog personId={journeyId} onClose={() => setJourneyId(null)} />
    </div>
  );
}

// ── card ─────────────────────────────────────────────────────────────────────

function BoardCardRow({
  card,
  draggable,
  dimmed,
  onDragStart,
  onDragEnd,
  onOpenJourney,
}: {
  card: BoardCard;
  draggable: boolean;
  dimmed: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenJourney: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.personId);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-colors",
        card.stalled && "border-l-4 border-l-amber-500",
        draggable && "cursor-grab active:cursor-grabbing hover:border-primary/40",
        dimmed && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onOpenJourney}
        className="w-full p-2.5 text-left"
        aria-label={`Open journey for ${card.name} — ${card.daysInStage} days in stage`}
      >
        <span className="block truncate text-sm font-medium">{card.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {card.daysInStage}d in stage
          {card.stalled ? (
            <Badge
              variant="outline"
              className="border-transparent bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              Stalled
            </Badge>
          ) : null}
        </span>
      </button>
    </div>
  );
}
