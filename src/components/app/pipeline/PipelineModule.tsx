"use client";

/**
 * Follow-up Pipeline — module shell: header + automation trigger + attention
 * chips + tab navigation (Board / Tasks / Sequences / Settings). Every tab
 * owns its own data fetching; shared API shapes live in pipeline-shared.tsx.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApiQuery, type ModuleProps } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Columns3, ListTodo, Settings, TimerReset, Workflow, Zap } from "lucide-react";
import KanbanBoardTab from "./KanbanBoardTab";
import FollowUpTasksTab from "./FollowUpTasksTab";
import SequencesTab from "./SequencesTab";
import PipelineSettingsTab from "./PipelineSettingsTab";
import { errMessage, type NeedsAttentionResp, type TickResp } from "./pipeline-shared";

export default function PipelineModule({ user }: ModuleProps) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("board");
  const [tickBusy, setTickBusy] = useState(false);
  const needsQ = useApiQuery<NeedsAttentionResp>(["pipeline", "needs-attention"], "/pipeline/needs-attention");

  async function runTick() {
    if (tickBusy) return;
    setTickBusy(true);
    try {
      const r = await api.post<TickResp>("/pipeline/tick");
      toast.success(
        `${r.messagesSent} message(s) sent · ${r.tasksCreated} task(s) created · ${r.stageMoves} stage move(s) · ${r.overdueFlagged} flagged overdue`,
      );
      await qc.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setTickBusy(false);
    }
  }

  const stalled = needsQ.data?.stalledCount ?? 0;
  const overdue = needsQ.data?.overdueCount ?? 0;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Follow-up Pipeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every person moving — no one silently lost.
          </p>
        </div>
        <Button onClick={() => void runTick()} disabled={tickBusy} className="h-11 lg:h-9">
          <Zap className="h-4 w-4" /> {tickBusy ? "Running…" : "Run automation"}
        </Button>
      </div>

      {/* attention chips */}
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <AttentionChip
          label="Stalled people"
          value={needsQ.isLoading ? null : stalled}
          zeroHint="Nobody stalled"
          onClick={() => setTab("board")}
          ariaLabel="Stalled people — open the board"
        />
        <AttentionChip
          label="Overdue tasks"
          value={needsQ.isLoading ? null : overdue}
          zeroHint="Nothing overdue"
          onClick={() => setTab("tasks")}
          ariaLabel="Overdue tasks — open the tasks tab"
        />
      </div>

      {/* tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="board" className="gap-1.5">
            <Columns3 className="h-4 w-4" /> Board
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListTodo className="h-4 w-4" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="sequences" className="gap-1.5">
            <Workflow className="h-4 w-4" /> Sequences
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings className="h-4 w-4" /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="mt-4">
          <KanbanBoardTab user={user} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <FollowUpTasksTab user={user} />
        </TabsContent>
        <TabsContent value="sequences" className="mt-4">
          <SequencesTab user={user} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <PipelineSettingsTab user={user} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── attention chip ───────────────────────────────────────────────────────────

function AttentionChip({
  label,
  value,
  zeroHint,
  onClick,
  ariaLabel,
}: {
  label: string;
  value: number | null;
  zeroHint: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  const alerting = value !== null && value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
    >
      <Card
        className={cn(
          "gap-1 py-3 transition-colors hover:border-primary/40",
          alerting && "border-amber-300 dark:border-amber-900",
        )}
      >
        <CardContent className="px-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <TimerReset className="h-3.5 w-3.5" aria-hidden /> {label}
          </p>
          {value === null ? (
            <Skeleton className="mt-1 h-7 w-12" aria-hidden />
          ) : (
            <p
              className={cn(
                "mt-1 text-2xl font-semibold tabular-nums",
                alerting ? "text-amber-700 dark:text-amber-400" : "text-foreground",
              )}
            >
              {value}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">{alerting ? "needs attention" : zeroHint}</p>
        </CardContent>
      </Card>
    </button>
  );
}
