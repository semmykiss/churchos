"use client";

/**
 * Follow-up tasks — what the automation assigned to humans. Volunteers
 * automatically see only their own tasks (server enforces scope); leadership
 * can flip between "My tasks" and "All tasks".
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { canDo, fmtDate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorBlock, LoadingBlock, useApiQuery, type ModuleProps } from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, SkipForward } from "lucide-react";
import {
  daysUntil,
  dueLabel,
  errMessage,
  type FollowUpTask,
  type TasksResp,
} from "./pipeline-shared";

const OVERDUE_BADGE =
  "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200";

export default function FollowUpTasksTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const canSeeAll = canDo(user, "pipeline.tasks.all");
  const [scope, setScope] = useState<"own" | "all">("own");
  const tasksQ = useApiQuery<TasksResp>(
    ["pipeline", "tasks", scope],
    `/pipeline/tasks${scope === "all" ? qs({ scope: "all" }) : ""}`,
  );

  const [action, setAction] = useState<{ task: FollowUpTask; mode: "complete" | "skip" } | null>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  const items = tasksQ.data?.items ?? [];
  const overdue = items.filter((t) => t.status === "overdue");
  const dueToday = items.filter((t) => t.status === "pending" && daysUntil(t.dueDate) <= 0);
  const upcoming = items.filter((t) => t.status === "pending" && daysUntil(t.dueDate) > 0);
  const done = items.filter((t) => t.status === "completed" || t.status === "skipped");
  const showAssignee = tasksQ.data?.scope === "all";

  async function submit() {
    if (!action) return;
    setBusy(true);
    try {
      const path =
        action.mode === "skip"
          ? `/pipeline/tasks/${action.task.id}/skip`
          : `/pipeline/tasks/${action.task.id}/complete`;
      await api.post(path, { outcomeNote: outcome.trim() || undefined });
      toast.success(action.mode === "skip" ? "Task skipped." : "Task marked complete.");
      setAction(null);
      setOutcome("");
      await qc.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* scope toggle — leadership only; volunteers are server-clamped to own */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canSeeAll ? (
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Task scope">
            <Button
              type="button"
              size="sm"
              variant={scope === "own" ? "secondary" : "ghost"}
              className="h-11 lg:h-8"
              aria-pressed={scope === "own"}
              onClick={() => setScope("own")}
            >
              My tasks
            </Button>
            <Button
              type="button"
              size="sm"
              variant={scope === "all" ? "secondary" : "ghost"}
              className="h-11 lg:h-8"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              All tasks
            </Button>
          </div>
        ) : (
          <p className="text-sm font-medium">My tasks</p>
        )}
        {tasksQ.data?.scope === "own" ? (
          <p className="text-xs text-muted-foreground">Showing only tasks assigned to you.</p>
        ) : null}
      </div>

      {tasksQ.isLoading ? (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : tasksQ.isError ? (
        <ErrorBlock error={tasksQ.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No follow-up tasks"
          description="When sequences fire they create tasks here. Use “Run automation” in the header to process the pipeline now."
        />
      ) : (
        <div className="space-y-5">
          <TaskSection
            title="Overdue"
            count={overdue.length}
            badge={<Badge variant="outline" className={cn("border-transparent", OVERDUE_BADGE)}>Overdue</Badge>}
            tasks={overdue}
            showAssignee={showAssignee}
            emptyText="Nothing is overdue — well done."
            onAct={(task, mode) => {
              setOutcome("");
              setAction({ task, mode });
            }}
          />
          <TaskSection
            title="Due today"
            count={dueToday.length}
            tasks={dueToday}
            showAssignee={showAssignee}
            emptyText="Nothing due today."
            onAct={(task, mode) => {
              setOutcome("");
              setAction({ task, mode });
            }}
          />
          <TaskSection
            title="Upcoming"
            count={upcoming.length}
            tasks={upcoming}
            showAssignee={showAssignee}
            emptyText="No upcoming tasks."
            onAct={(task, mode) => {
              setOutcome("");
              setAction({ task, mode });
            }}
          />

          {done.length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-muted/60">
                <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
                Completed / skipped
                <Badge variant="secondary" className="tabular-nums">{done.length}</Badge>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="divide-y rounded-lg border border-t-0 px-3" role="list">
                  {done.map((t) => (
                    <li key={t.id} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{t.personName}</span>
                        <span className="text-sm text-muted-foreground">— {t.title}</span>
                        <Badge variant="outline" className="border-transparent bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                          {t.status === "skipped" ? "Skipped" : "Completed"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t.completedAt ? `Closed ${fmtDate(t.completedAt)}` : ""}
                        {t.outcomeNote ? ` · ${t.outcomeNote}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      )}

      {/* complete / skip dialog */}
      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{action?.mode === "skip" ? "Skip task" : "Mark task complete"}</DialogTitle>
            <DialogDescription>
              {action ? `${action.task.personName} — ${action.task.title}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="task-outcome">Outcome note (optional)</Label>
            <Textarea
              id="task-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="What happened?"
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11 lg:h-9" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              className="h-11 lg:h-9"
              variant={action?.mode === "skip" ? "secondary" : "default"}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Saving…" : action?.mode === "skip" ? "Skip task" : "Mark complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── section ──────────────────────────────────────────────────────────────────

function TaskSection({
  title,
  count,
  badge,
  tasks,
  showAssignee,
  emptyText,
  onAct,
}: {
  title: string;
  count: number;
  badge?: React.ReactNode;
  tasks: FollowUpTask[];
  showAssignee: boolean;
  emptyText: string;
  onAct: (task: FollowUpTask, mode: "complete" | "skip") => void;
}) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          {title}
          <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
        </h3>
        {badge}
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y rounded-lg border" role="list">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium">{t.personName}</span>
                  <span className="text-muted-foreground"> — {t.title}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {t.sequenceName ? (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                      {t.sequenceName}
                    </Badge>
                  ) : null}
                  <span className={cn("tabular-nums", t.status === "overdue" && "font-medium text-destructive")}>
                    {dueLabel(t.dueDate)} · {fmtDate(t.dueDate)}
                  </span>
                  {showAssignee && t.assignedToName ? <span>· {t.assignedToName}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 gap-1.5 lg:h-8"
                  onClick={() => onAct(t, "complete")}
                  aria-label={`Mark complete: ${t.title} for ${t.personName}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 gap-1.5 lg:h-8"
                  onClick={() => onAct(t, "skip")}
                  aria-label={`Skip: ${t.title} for ${t.personName}`}
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
