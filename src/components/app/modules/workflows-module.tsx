"use client";

/**
 * Workflows — five opinionated templates, no builder.
 * Activate/deactivate, dry-run against a real person, and a run log.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDateTime, type WorkflowRunDTO, type PersonListItem, type Paged } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bell, CheckCircle2, ClipboardList, FlaskConical, Mail, MessageSquare, Tag, Zap,
} from "lucide-react";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, Section, StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ── local shapes ─────────────────────────────────────────────────────────────
interface WorkflowDTO {
  id: string;
  name: string;
  triggerType: string;
  isActive: boolean;
  version: number;
  steps: { type: string; [k: string]: unknown }[];
  stats: { fired: number; suppressed: number; lastRunAt: string | null };
}
interface TestResult {
  workflow: { id: string; name: string };
  person: { id: string; name: string };
  suppressed?: string;
  steps: { type: string; detail: string; suppressed?: boolean }[];
}

const TRIGGER_LABELS: Record<string, string> = {
  first_visit: "Trigger: first visit",
  second_visit: "Second visit",
  new_member: "New member",
  birthday: "Birthday",
  three_week_absence: "3-week absence",
};
const STEP_ICONS: Record<string, React.ElementType> = {
  task: ClipboardList,
  email: Mail,
  sms: MessageSquare,
  tag: Tag,
  notify: Bell,
};

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.";
}

/** Search + pick a person (GET people?search=). */
function PersonPicker({ onPick, picked }: {
  onPick: (p: { id: string; name: string }) => void;
  picked: { id: string; name: string } | null;
}) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useApiQuery<Paged<PersonListItem>>(
    ["people", "search", q],
    `/people${qs({ search: q, pageSize: 8 })}`,
    { placeholderData: (prev) => prev },
  );
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name or email…" aria-label="Search people" />
      <div className="max-h-56 overflow-y-auto scroll-slim rounded-md border" role="listbox" aria-label="Search results">
        {isLoading ? <p className="p-3 text-xs text-muted-foreground">Searching…</p>
          : !data?.items.length ? <p className="p-3 text-xs text-muted-foreground">No people matched.</p>
          : data.items.map((p) => (
            <button
              key={p.id} type="button" role="option" aria-selected={picked?.id === p.id}
              className={cn("flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent rounded-md", picked?.id === p.id && "bg-accent")}
              onClick={() => onPick({ id: p.id, name: `${p.firstName} ${p.lastName}` })}
            >
              <PersonAvatar name={`${p.firstName} ${p.lastName}`} className="h-7 w-7 text-[10px]" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.firstName} {p.lastName}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

// ── module ───────────────────────────────────────────────────────────────────
export default function WorkflowsModule({ user: _user }: ModuleProps) {
  const wfQ = useApiQuery<{ items: WorkflowDTO[] }>(["workflows"], "/workflows");
  const runsQ = useApiQuery<{ items: WorkflowRunDTO[] }>(["workflows", "runs"], `/workflow-runs${qs({ limit: 50 })}`);

  const [testFor, setTestFor] = useState<WorkflowDTO | null>(null);

  const items = wfQ.data?.items ?? [];
  const activeCount = items.filter((w) => w.isActive).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Five opinionated follow-up automations. No builder — turn them on, test them, and watch the run log."
      />

      {wfQ.isLoading ? <LoadingBlock label="Loading workflows…" />
        : wfQ.error ? <ErrorBlock error={wfQ.error} />
        : !items.length ? (
          <EmptyState icon={Zap} title="No workflows" description="Your organization has no automation templates yet." />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{activeCount} of {items.length} active. A dry run never sends anything.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((w) => <WorkflowCard key={w.id} wf={w} onTest={() => setTestFor(w)} />)}
            </div>
          </>
        )}

      <Section title="Run log" description="The 50 most recent automation runs across all templates.">
        {runsQ.isLoading ? <LoadingBlock />
          : runsQ.error ? <ErrorBlock error={runsQ.error} />
          : !runsQ.data?.items.length ? (
            <EmptyState icon={CheckCircle2} title="No runs yet" description="Activated workflows will log each run here — fired or suppressed." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsQ.data.items.map((r) => {
                    const reason = r.firedReason ?? "";
                    const tone = reason.startsWith("suppressed:") ? "muted" : reason.startsWith("fired:") ? "positive" : "default";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium whitespace-nowrap">{r.workflow?.name ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.subjectName ?? "—"}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell>
                          {reason ? (
                            <span className={cn(
                              "font-mono text-xs",
                              tone === "positive" && "text-teal-700 dark:text-teal-400",
                              tone === "muted" && "text-muted-foreground",
                            )}>
                              {reason}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">{r.detail ? String(r.detail).slice(0, 60) : "—"}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.startedAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
      </Section>

      <TestDialog wf={testFor} onClose={() => setTestFor(null)} />
    </div>
  );
}

function WorkflowCard({ wf, onTest }: { wf: WorkflowDTO; onTest: () => void }) {
  const queryClient = useQueryClient();
  const toggleMut = useMutation({
    mutationFn: (isActive: boolean) => api.post(`/workflows/${wf.id}/toggle`, { isActive }),
    onSuccess: (_res, isActive) => {
      toast.success(`${wf.name} ${isActive ? "activated" : "deactivated"}.`);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Card className={cn(!wf.isActive && "opacity-90")}>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{wf.name}</CardTitle>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" aria-hidden /> {TRIGGER_LABELS[wf.triggerType] ?? wf.triggerType}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label className="sr-only" htmlFor={`wf-switch-${wf.id}`}>Activate {wf.name}</Label>
          <Switch
            id={`wf-switch-${wf.id}`}
            checked={wf.isActive}
            disabled={toggleMut.isPending}
            onCheckedChange={(v) => toggleMut.mutate(v)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="flex flex-wrap gap-1.5">
          {wf.steps.map((s, i) => {
            const Icon = STEP_ICONS[s.type] ?? ClipboardList;
            const title = typeof s.title === "string" ? s.title : typeof s.subject === "string" ? s.subject : "";
            return (
              <li key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
                <Icon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="font-medium text-foreground">{i + 1}.</span>
                <span className="capitalize">{s.type}</span>
                {title ? <span className="hidden truncate sm:inline">· {title}</span> : null}
              </li>
            );
          })}
        </ol>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-teal-700 tabular-nums dark:text-teal-400">{wf.stats.fired}</span> fired ·{" "}
            <span className="tabular-nums">{wf.stats.suppressed}</span> suppressed
          </span>
          <span>{wf.stats.lastRunAt ? `Last run ${fmtDateTime(wf.stats.lastRunAt)}` : "Never run"}</span>
        </div>
        <div className="flex items-center justify-between">
          <Badge variant="outline">v{wf.version}</Badge>
          <Button variant="outline" size="sm" onClick={onTest}>
            <FlaskConical /> Test run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TestDialog({ wf, onClose }: { wf: WorkflowDTO | null; onClose: () => void }) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);

  const testMut = useMutation({
    mutationFn: (personId: string) => api.post<TestResult>(`/workflows/${wf?.id}/test`, { personId }),
    onSuccess: (res) => setResult(res),
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Dialog open={!!wf} onOpenChange={(o) => { if (!o) { setPicked(null); setResult(null); onClose(); } }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto scroll-slim">
        <DialogHeader>
          <DialogTitle>Test run — {wf?.name}</DialogTitle>
          <DialogDescription>Dry run against a real person. Nothing is sent, created, or logged.</DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <Label>Pick a person</Label>
            <PersonPicker onPick={setPicked} picked={picked} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Dry run for <span className="font-medium">{result.person.name}</span>
              {result.suppressed ? (
                <span className="ml-1 text-amber-700 dark:text-amber-400">— run suppressed: {result.suppressed.replace("suppressed:", "")}</span>
              ) : null}
            </p>
            <ol className="space-y-2">
              {result.steps.map((s, i) => {
                const Icon = STEP_ICONS[s.type] ?? ClipboardList;
                return (
                  <li key={i} className={cn("flex items-start gap-2 rounded-md border p-3 text-sm", s.suppressed && "opacity-55")}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Step {i + 1} · {s.type}{s.suppressed ? " · suppressed" : ""}
                      </p>
                      <p className="break-words">{s.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={() => setResult(null)}>Test someone else</Button>
          ) : null}
          <Button disabled={!picked || testMut.isPending} onClick={() => picked && testMut.mutate(picked.id)}>
            {testMut.isPending ? "Running…" : "Run dry test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
