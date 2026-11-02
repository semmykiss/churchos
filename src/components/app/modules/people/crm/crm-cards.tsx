"use client";

/**
 * People CRM v2 — Cards view (Phase 3): a directory grid with large photos.
 * Cards are virtualized in BANDS (rows of N cards) so 5,000+ records scroll
 * smoothly; the band width drives the responsive column count (2–5 columns).
 * Selection checkboxes feed the same bulk bar as the table view; field
 * visibility was already decided server-side by the people serializer.
 */
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Home, Loader2, Mail, MessageCircle, Phone, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorBlock, PersonAvatar, StageBadge,
} from "@/components/app/shared";
import { relLastSeen, waLink, type CrmPersonRow } from "./crm-shared";
import { cn } from "@/lib/utils";

interface CrmCardsProps {
  rows: CrmPersonRow[];
  totalCount: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  hasNarrowing: boolean;
  selection?: Set<string> | null;
  onToggleRow?: (id: string) => void;
  onRowOpen: (row: CrmPersonRow) => void;
  onLoadMore: () => void;
  onClearNarrowing: () => void;
  emptyAction?: React.ReactNode;
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4" aria-hidden>
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-3 flex justify-center gap-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
    </div>
  );
}

function CrmCardsInner(props: CrmCardsProps) {
  const { rows, totalCount, isLoading, isFetchingNextPage, hasNextPage, error, hasNarrowing, selection } = props;
  const parentRef = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(4);
  const selectEnabled = selection instanceof Set;

  // Responsive column count from the SCROLLER's measured width.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setPerRow(w >= 1180 ? 5 : w >= 920 ? 4 : w >= 640 ? 3 : w >= 430 ? 2 : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bandCount = Math.ceil(rows.length / perRow);
  const virtualizer = useVirtualizer({
    count: bandCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 252,
    overscan: 2,
  });

  // Infinite scroll near the end of the loaded bands.
  const rangeEnd = virtualizer.range?.endIndex ?? 0;
  useEffect(() => {
    if (rangeEnd === 0) return;
    if (rangeEnd >= bandCount - 2 && hasNextPage && !isFetchingNextPage) props.onLoadMore();
  }, [rangeEnd, bandCount, hasNextPage, isFetchingNextPage, props.onLoadMore]);

  if (error) return <ErrorBlock error={error} />;

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
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto scroll-slim max-h-[calc(100vh-320px)] min-h-[320px] p-4"
        role="list"
        aria-label="People directory cards"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {isLoading ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
              {Array.from({ length: perRow * 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : (
            virtualizer.getVirtualItems().map((vi) => {
              const band = rows.slice(vi.index * perRow, vi.index * perRow + perRow);
              return (
                <div
                  key={vi.key}
                  role="presentation"
                  className="grid gap-4 pb-4"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                    gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`,
                  }}
                >
                  {band.map((row) => {
                    const name = `${row.firstName} ${row.lastName}`;
                    const wa = waLink(row.whatsappE164 ?? row.phoneE164);
                    const seen = relLastSeen(row.lastAttendedAt);
                    const selected = selectEnabled && selection!.has(row.id);
                    return (
                      <div
                        key={row.id}
                        role="listitem"
                        tabIndex={0}
                        aria-label={`Open ${name}`}
                        onClick={() => props.onRowOpen(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            props.onRowOpen(row);
                          }
                        }}
                        className={cn(
                          "group row-hover relative cursor-pointer rounded-xl border bg-card p-4 shadow-xs transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                          selected && "ring-2 ring-primary"
                        )}
                      >
                        {selectEnabled ? (
                          <div
                            className="absolute right-2.5 top-2.5 z-10"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => props.onToggleRow?.(row.id)}
                              aria-label={`Select ${name}`}
                            />
                          </div>
                        ) : null}

                        <div className="flex flex-col items-center gap-1.5 text-center">
                          <PersonAvatar name={name} src={row.photoUrl} className="h-20 w-20 text-lg" child={row.age != null && row.age < 13} />
                          <p className="mt-1 max-w-full truncate text-sm font-semibold">
                            {row.firstName} {row.lastName}
                          </p>
                          {row.preferredName ? (
                            <p className="-mt-1 max-w-full truncate text-xs text-muted-foreground">“{row.preferredName}”</p>
                          ) : null}
                          <StageBadge stage={row.lifecycleStage} />
                          {row.household ? (
                            <p className="flex max-w-full items-center gap-1 text-xs text-muted-foreground">
                              <Home className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="truncate">{row.household.name}</span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/70">No household</p>
                          )}
                          {row.tags.length > 0 ? (
                            <p className="max-w-full truncate text-[11px] text-muted-foreground">{row.tags.map((t) => t.name).join(" · ")}</p>
                          ) : null}
                          <p className="text-[11px] text-muted-foreground">Last seen {seen.text.toLowerCase()}</p>
                        </div>

                        <div className="mt-3 flex items-center justify-center gap-1 border-t pt-2.5">
                          {row.phoneE164 ? (
                            <a
                              href={`tel:${row.phoneE164}`}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
                              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                              aria-label={`WhatsApp ${name}`}
                            >
                              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                            </a>
                          ) : null}
                          {row.email ? (
                            <a
                              href={`mailto:${row.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                              aria-label={`Email ${name}`}
                            >
                              <Mail className="h-3.5 w-3.5" aria-hidden />
                            </a>
                          ) : null}
                          {!row.phoneE164 && !wa && !row.email ? (
                            <span className="text-[11px] text-muted-foreground">Contact private or missing</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {isFetchingNextPage ? (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
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

/** Keyed by column count so virtualizer measurements reset cleanly. */
export function CrmCards(props: CrmCardsProps) {
  return <CrmCardsInner {...props} />;
}
