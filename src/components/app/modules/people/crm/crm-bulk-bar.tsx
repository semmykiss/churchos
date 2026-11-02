"use client";

/**
 * People CRM v2 — bulk action bar (Phase 3). Appears when a selection exists.
 * Every action runs through the SINGLE bulk endpoint (POST /people/bulk):
 * the server re-checks permissions PER RECORD and returns a per-record
 * success/fail summary, which this bar surfaces. The confirm dialog always
 * shows the affected count; "select all N matching filter" works even when
 * only one page is loaded (the server resolves the ids).
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Tag, Users, Layers, UserCheck, Archive, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PersonCombobox } from "../person-search";
import { STAGE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BulkResult, FilterGroup } from "./crm-shared";
import type { FilterOptions } from "./crm-filters";

export type BulkAction = "add_tag" | "add_to_group" | "change_stage" | "assign_shepherd" | "archive";

interface CrmBulkBarProps {
  selectedCount: number;
  /** Total people matching the current search + filters (server-computed). */
  totalMatching: number;
  allMatching: boolean;
  options: FilterOptions;
  canTags: boolean;
  canGroups: boolean;
  canArchive: boolean;
  onSelectAllMatching: () => void;
  onRun: (action: BulkAction, params: Record<string, unknown>) => Promise<BulkResult>;
  onExport: () => void;
  onDone: () => void;
}

const ACTION_LABELS: Record<BulkAction, string> = {
  add_tag: "Add tag",
  add_to_group: "Add to group",
  change_stage: "Change stage",
  assign_shepherd: "Assign shepherd",
  archive: "Archive",
};

export function CrmBulkBar({
  selectedCount, totalMatching, allMatching, options, canTags, canGroups, canArchive,
  onSelectAllMatching, onRun, onExport, onDone,
}: CrmBulkBarProps) {
  const [pending, setPending] = useState<{ action: BulkAction; params: Record<string, unknown> } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [tagId, setTagId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [stage, setStage] = useState("");
  const [shepherdId, setShepherdId] = useState("");
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);

  const confirm = (action: BulkAction, params: Record<string, unknown>) => {
    setPending({ action, params });
    setPickerOpen(null);
  };

  const execute = async () => {
    if (!pending) return;
    setRunning(true);
    try {
      const res = await onRun(pending.action, pending.params);
      // Show the per-record summary FIRST; the selection is cleared when the
      // dialog closes (the dialog lives inside this bar — clearing the
      // selection here would unmount it before the user reads it).
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk action failed.");
    } finally {
      setRunning(false);
      setPending(null);
    }
  };

  const finishResult = () => {
    setResult(null);
    onDone();
  };

  const picker = (id: string, enabled: boolean) => pickerOpen === id && enabled;

  return (
    <>
      <div
        className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1.5 rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur"
        role="toolbar"
        aria-label="Bulk actions for selected people"
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary tabular-nums">
          {selectedCount} selected
        </span>

        {!allMatching && totalMatching > selectedCount ? (
          <button
            type="button"
            className="whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={onSelectAllMatching}
          >
            Select all {totalMatching.toLocaleString()} matching
          </button>
        ) : null}
        {allMatching ? (
          <span className="whitespace-nowrap px-1 text-xs font-medium text-muted-foreground">
            all matching people
          </span>
        ) : null}

        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

        {/* Add tag */}
        <Popover open={picker("tag", canTags)} onOpenChange={(o) => setPickerOpen(o ? "tag" : null)}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={!canTags} aria-label="Add tag to selection">
              <Tag className="h-3.5 w-3.5" aria-hidden /> Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 p-2">
            <p className="px-1 pb-1.5 text-xs font-semibold">Choose a tag</p>
            <div className="max-h-56 overflow-y-auto scroll-slim">
              {options.tags.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">No tags yet — create one on a person record first.</p>
              ) : (
                options.tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                      tagId === t.id && "bg-primary/10 text-primary",
                    )}
                    onClick={() => setTagId(t.id)}
                  >
                    {t.name}
                  </button>
                ))
              )}
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-2 w-full"
              disabled={!tagId}
              onClick={() => confirm("add_tag", { tagId })}
            >
              Apply to {selectedCount.toLocaleString()} people
            </Button>
          </PopoverContent>
        </Popover>

        {/* Add to group */}
        <Popover open={picker("group", canGroups)} onOpenChange={(o) => setPickerOpen(o ? "group" : null)}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={!canGroups} aria-label="Add selection to a group">
              <Users className="h-3.5 w-3.5" aria-hidden /> Group
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <p className="px-1 pb-1.5 text-xs font-semibold">Choose a group</p>
            <div className="max-h-56 overflow-y-auto scroll-slim">
              {options.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                    groupId === g.id && "bg-primary/10 text-primary",
                  )}
                  onClick={() => setGroupId(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-2 w-full"
              disabled={!groupId}
              onClick={() => confirm("add_to_group", { groupId })}
            >
              Apply to {selectedCount.toLocaleString()} people
            </Button>
          </PopoverContent>
        </Popover>

        {/* Change stage */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-label="Change stage for selection">
              <Layers className="h-3.5 w-3.5" aria-hidden /> Stage
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-xs">Move to stage</DropdownMenuLabel>
            {Object.entries(STAGE_LABELS).filter(([k]) => k !== "archived").map(([k, label]) => (
              <DropdownMenuItem key={k} onClick={() => confirm("change_stage", { stage: k })}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign shepherd */}
        <Popover open={picker("shepherd", true)} onOpenChange={(o) => setPickerOpen(o ? "shepherd" : null)}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-label="Assign a shepherd to selection">
              <UserCheck className="h-3.5 w-3.5" aria-hidden /> Shepherd
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-2 p-3">
            <p className="text-xs font-semibold">Assign a shepherd</p>
            <PersonCombobox
              value={shepherdId || null}
              onSelect={(p) => setShepherdId(p?.id ?? "")}
              placeholder="Search for a shepherd…"
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!shepherdId}
              onClick={() => confirm("assign_shepherd", { shepherdId })}
            >
              Apply to {selectedCount.toLocaleString()} people
            </Button>
          </PopoverContent>
        </Popover>

        <Button type="button" variant="outline" size="sm" onClick={onExport} aria-label="Export selection as CSV">
          <Download className="h-3.5 w-3.5" aria-hidden /> Export
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!canArchive}
          onClick={() => confirm("archive", {})}
          aria-label="Archive selection"
        >
          <Archive className="h-3.5 w-3.5" aria-hidden /> Archive
        </Button>

        <Button type="button" variant="ghost" size="icon" onClick={onDone} aria-label="Clear selection" className="h-8 w-8">
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* confirm — always shows the affected count */}
      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o && !running) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pending?.action === "archive" ? (
                <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              )}
              {pending ? ACTION_LABELS[pending.action] : ""} · {selectedCount.toLocaleString()} {selectedCount === 1 ? "person" : "people"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.action === "archive"
                ? `Archived people leave the active directory but keep their giving and attendance history. This applies to ${selectedCount.toLocaleString()} ${selectedCount === 1 ? "person" : "people"}.`
                : `Records you can't edit are skipped automatically and reported back with a reason.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void execute(); }}
              disabled={running}
              className={cn(pending?.action === "archive" && "bg-destructive text-white hover:bg-destructive/90")}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending?.action === "archive" ? "Archive people" : "Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* per-record result summary */}
      <Dialog open={result !== null} onOpenChange={(o) => { if (!o) finishResult(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {result && result.failed.length === 0 ? (
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              )}
              {result ? `${result.succeeded} of ${result.total} updated` : ""}
            </DialogTitle>
            <DialogDescription>
              {result && result.failed.length === 0
                ? "All done — every record was updated."
                : `${result?.failed.length ?? 0} ${result?.failed.length === 1 ? "record was" : "records were"} skipped.`}
            </DialogDescription>
          </DialogHeader>
          {result && result.failed.length > 0 ? (
            <ScrollArea className="max-h-64 rounded-lg border">
              <ul className="divide-y text-xs">
                {result.failed.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-right text-muted-foreground">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : null}
          <Button type="button" onClick={finishResult}>Close</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Human summary for a saved view card (server passes filters through). */
export function describeViewFilters(filters: FilterGroup | null, describe: (c: { field: string; op: string; value?: unknown }) => string): string {
  if (!filters || filters.conditions.length === 0) return "Everyone in the directory";
  return filters.conditions.map(describe).join(filters.match === "any" ? " OR " : " AND ");
}
