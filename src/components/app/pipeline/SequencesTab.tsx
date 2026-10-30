"use client";

/**
 * Sequences — automation recipes attached to pipeline stages. When a person
 * enters the trigger stage, steps fire automatically at their day offset
 * (the daily tick drives execution). Editing is gated on pipeline.manage.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorBlock, LoadingBlock, useApiQuery, type ModuleProps } from "@/components/app/shared";
import { StatusBadge } from "@/components/app/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Info, Plus, Trash2, Workflow, X } from "lucide-react";
import {
  ACTION_TYPE_LABELS,
  CHANNEL_LABELS,
  type Sequence,
  type SequenceSavePayload,
  type SequenceSaveStep,
  type SequencesResp,
  type PipelineStagesResp,
  type StepActionType,
  errMessage,
} from "./pipeline-shared";

// ── step draft ───────────────────────────────────────────────────────────────

interface StepDraft {
  dayOffset: number;
  actionType: StepActionType;
  channel: "whatsapp" | "sms" | "email";
  messageTemplate: string;
  assignToRole: string;
  moveTargetStageId: string;
}

function newStep(): StepDraft {
  return { dayOffset: 1, actionType: "auto_message", channel: "whatsapp", messageTemplate: "", assignToRole: "volunteer", moveTargetStageId: "" };
}

function stepsFromSequence(seq: Sequence): StepDraft[] {
  return seq.steps.map((s) => ({
    dayOffset: s.dayOffset,
    actionType: s.actionType,
    channel: s.channel === "sms" || s.channel === "email" ? s.channel : "whatsapp",
    messageTemplate: s.messageTemplate ?? "",
    assignToRole: s.assignToRole ?? "volunteer",
    moveTargetStageId: s.moveTargetStageId ?? "",
  }));
}

function stepProblem(step: StepDraft): string | null {
  if (!Number.isFinite(step.dayOffset) || step.dayOffset < 0 || step.dayOffset > 365) {
    return "Day offset must be 0–365.";
  }
  if (step.actionType === "auto_message" && !step.messageTemplate.trim()) {
    return "Message steps need a message template.";
  }
  if (step.actionType === "move_stage" && !step.moveTargetStageId) {
    return "Move-stage steps need a target stage.";
  }
  return null;
}

function toPayload(
  name: string,
  description: string,
  triggerStageId: string,
  isActive: boolean,
  steps: StepDraft[],
  id?: string,
): SequenceSavePayload {
  const mapped: SequenceSaveStep[] = steps.map((s) => {
    const base: SequenceSaveStep = { dayOffset: Math.round(s.dayOffset), actionType: s.actionType };
    if (s.actionType === "auto_message") {
      return { ...base, channel: s.channel, messageTemplate: s.messageTemplate.trim() };
    }
    if (s.actionType === "assign_task") {
      return { ...base, assignToRole: s.assignToRole.trim() || "volunteer" };
    }
    return { ...base, moveTargetStageId: s.moveTargetStageId };
  });
  const payload: SequenceSavePayload = {
    name: name.trim(),
    isActive,
    steps: mapped,
  };
  if (id) payload.id = id;
  if (description.trim()) payload.description = description.trim();
  if (triggerStageId) payload.triggerStageId = triggerStageId;
  return payload;
}

/** Rebuild the save payload from a fetched sequence (quick activate/pause). */
function payloadFromSequence(seq: Sequence, isActive: boolean): SequenceSavePayload {
  return toPayload(seq.name, seq.description ?? "", seq.triggerStage?.id ?? "", isActive, stepsFromSequence(seq), seq.id);
}

// ── tab ──────────────────────────────────────────────────────────────────────

export default function SequencesTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const canManage = canDo(user, "pipeline.manage");
  const seqsQ = useApiQuery<SequencesResp>(["pipeline", "sequences"], "/pipeline/sequences");
  const stagesQ = useApiQuery<PipelineStagesResp>(["pipeline", "stages"], "/pipeline/stages");

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // null = closed; seq === null = creating a new sequence
  const [editor, setEditor] = useState<{ seq: Sequence | null } | null>(null);

  const sequences = seqsQ.data?.items ?? [];
  const stages = (stagesQ.data?.items ?? []).filter((s) => s.isActive);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["pipeline", "sequences"] });
  }

  async function toggleActive(seq: Sequence, isActive: boolean) {
    setTogglingId(seq.id);
    try {
      await api.post("/pipeline/sequences", payloadFromSequence(seq, isActive));
      toast.success(isActive ? `${seq.name} activated.` : `${seq.name} paused.`);
      await refresh();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(seq: Sequence) {
    setDeletingId(seq.id);
    try {
      await api.del(`/pipeline/sequences/${seq.id}`);
      toast.success(`Sequence “${seq.name}” deleted.`);
      await refresh();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" aria-hidden />
        <AlertDescription className="text-sm">
          When a person enters the trigger stage, steps fire automatically at their day offset. The tick runs daily in
          production — use <span className="font-medium">Run automation</span> to run it now.
        </AlertDescription>
      </Alert>

      {canManage ? (
        <div className="flex justify-end">
          <Button className="h-11 lg:h-9" onClick={() => setEditor({ seq: null })}>
            <Plus className="h-4 w-4" /> New sequence
          </Button>
        </div>
      ) : null}

      {seqsQ.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-hidden>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border p-4">
              <div className="h-5 w-40 rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-2/3 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : seqsQ.isError ? (
        <ErrorBlock error={seqsQ.error} />
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No sequences yet"
          description={
            canManage
              ? "Create a sequence to send messages, assign tasks or move people automatically when they enter a stage."
              : "No automation has been configured for the pipeline yet."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sequences.map((seq) => {
            // re-validate stored steps so a broken sequence can't be re-saved/toggled by accident
            const problem = stepsFromSequence(seq).map(stepProblem).find(Boolean) ?? null;
            return (
              <Card key={seq.id} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-snug">{seq.name}</CardTitle>
                      {seq.description ? (
                        <CardDescription className="mt-1 line-clamp-2">{seq.description}</CardDescription>
                      ) : null}
                    </div>
                    {canManage ? (
                      <Switch
                        checked={seq.isActive}
                        disabled={togglingId === seq.id || !!problem}
                        onCheckedChange={(v) => void toggleActive(seq, v)}
                        aria-label={`${seq.isActive ? "Pause" : "Activate"} ${seq.name}`}
                      />
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="bg-muted/50 font-normal">
                      Triggers: {seq.triggerStage?.name ?? "no stage"}
                    </Badge>
                    <StatusBadge status={seq.isActive ? "active" : "paused"} />
                  </div>

                  {seq.steps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No steps yet.</p>
                  ) : (
                    <ul className="space-y-1.5" aria-label={`${seq.name} steps`}>
                      {seq.steps.map((s) => (
                        <li key={s.id} className="flex items-baseline gap-2 text-sm">
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Day {s.dayOffset}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {ACTION_TYPE_LABELS[s.actionType]}
                            {s.actionType === "auto_message" && s.channel
                              ? ` (${CHANNEL_LABELS[s.channel] ?? s.channel})`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canManage ? (
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11 flex-1 lg:h-8 lg:flex-none"
                        onClick={() => setEditor({ seq })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-11 flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-8 lg:flex-none"
                        disabled={deletingId === seq.id}
                        aria-label={`Delete sequence ${seq.name}`}
                        onClick={() => void remove(seq)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editor ? (
        <SequenceEditor
          key={editor.seq?.id ?? "new"}
          seq={editor.seq}
          stages={stages}
          canManage={canManage}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

// ── editor dialog ────────────────────────────────────────────────────────────

function SequenceEditor({
  seq,
  stages,
  canManage,
  onClose,
  onSaved,
}: {
  seq: Sequence | null;
  stages: { id: string; name: string }[];
  canManage: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(seq?.name ?? "");
  const [description, setDescription] = useState(seq?.description ?? "");
  const [triggerStageId, setTriggerStageId] = useState(seq?.triggerStage?.id ?? "");
  const [isActive, setIsActive] = useState(seq?.isActive ?? true);
  const [steps, setSteps] = useState<StepDraft[]>(seq ? stepsFromSequence(seq) : [newStep()]);
  const [busy, setBusy] = useState(false);

  const problems = steps.map(stepProblem);
  const hasProblem = !name.trim() || problems.some(Boolean);

  function patchStep(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function moveStep(i: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (hasProblem || busy) return;
    setBusy(true);
    try {
      await api.post("/pipeline/sequences", toPayload(name, description, triggerStageId, isActive, steps, seq?.id));
      toast.success(seq ? `Sequence “${name.trim()}” updated.` : `Sequence “${name.trim()}” created.`);
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scroll-slim sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{seq ? `Edit sequence — ${seq.name}` : "New sequence"}</DialogTitle>
          <DialogDescription>
            Steps run in order for everyone who enters the trigger stage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="seq-name">Name</Label>
              <Input
                id="seq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. First-visit follow-up"
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seq-trigger">Trigger stage</Label>
              <Select value={triggerStageId} onValueChange={setTriggerStageId} disabled={!canManage}>
                <SelectTrigger id="seq-trigger" className="w-full">
                  <SelectValue placeholder="No trigger (manual)" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Steps fire when someone enters this stage.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seq-desc">Description (optional)</Label>
            <Input
              id="seq-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this sequence accomplishes"
              disabled={!canManage}
            />
          </div>

          {/* step builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 lg:h-8"
                  onClick={() => setSteps((prev) => [...prev, newStep()])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add step
                </Button>
              ) : null}
            </div>

            {steps.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No steps — this sequence would do nothing. Add one below.
              </p>
            ) : (
              <ol className="space-y-3">
                {steps.map((step, i) => {
                  const problem = problems[i];
                  return (
                    <li key={i} className="space-y-3 rounded-lg border p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-[5.5rem] space-y-1">
                          <Label htmlFor={`step-day-${i}`} className="text-[11px] text-muted-foreground">
                            Day
                          </Label>
                          <Input
                            id={`step-day-${i}`}
                            type="number"
                            min={0}
                            max={365}
                            value={step.dayOffset}
                            onChange={(e) => {
                              const n = e.target.valueAsNumber;
                              patchStep(i, { dayOffset: Number.isFinite(n) ? Math.max(0, Math.min(365, Math.round(n))) : 0 });
                            }}
                            className="h-11 lg:h-9"
                            disabled={!canManage}
                            aria-label="Day offset"
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <Label htmlFor={`step-action-${i}`} className="text-[11px] text-muted-foreground">
                            Action
                          </Label>
                          <Select
                            value={step.actionType}
                            onValueChange={(v) => patchStep(i, { actionType: v as StepActionType })}
                            disabled={!canManage}
                          >
                            <SelectTrigger id={`step-action-${i}`} className="h-11 w-full lg:h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(ACTION_TYPE_LABELS) as StepActionType[]).map((a) => (
                                <SelectItem key={a} value={a}>
                                  {ACTION_TYPE_LABELS[a]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {canManage ? (
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11 lg:h-9 lg:w-9"
                              disabled={i === 0}
                              onClick={() => moveStep(i, -1)}
                              aria-label={`Move step ${i + 1} up`}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11 lg:h-9 lg:w-9"
                              disabled={i === steps.length - 1}
                              onClick={() => moveStep(i, 1)}
                              aria-label={`Move step ${i + 1} down`}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9 lg:w-9"
                              onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                              aria-label={`Remove step ${i + 1}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      {/* per-type fields */}
                      {step.actionType === "auto_message" ? (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`step-channel-${i}`} className="text-[11px] text-muted-foreground">
                              Channel
                            </Label>
                            <Select
                              value={step.channel}
                              onValueChange={(v) => patchStep(i, { channel: v as StepDraft["channel"] })}
                              disabled={!canManage}
                            >
                              <SelectTrigger id={`step-channel-${i}`} className="h-11 w-full sm:w-48 lg:h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                <SelectItem value="sms">SMS</SelectItem>
                                <SelectItem value="email">Email</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground">
                              WhatsApp sends automatically; SMS/Email create a task for a volunteer.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`step-msg-${i}`} className="text-[11px] text-muted-foreground">
                              Message
                            </Label>
                            <Textarea
                              id={`step-msg-${i}`}
                              value={step.messageTemplate}
                              onChange={(e) => patchStep(i, { messageTemplate: e.target.value })}
                              placeholder="Hi {{name}}, great to have you with us on Sunday!"
                              className="min-h-[64px]"
                              disabled={!canManage}
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Tip: use <code className="rounded bg-muted px-1">{"{{name}}"}</code> to greet them by first name.
                            </p>
                          </div>
                        </div>
                      ) : step.actionType === "assign_task" ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`step-role-${i}`} className="text-[11px] text-muted-foreground">
                            Assign to role
                          </Label>
                          <Input
                            id={`step-role-${i}`}
                            value={step.assignToRole}
                            onChange={(e) => patchStep(i, { assignToRole: e.target.value })}
                            placeholder="volunteer"
                            className="h-11 sm:w-64 lg:h-9"
                            disabled={!canManage}
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Role key, e.g. <code className="rounded bg-muted px-1">volunteer</code>. The least-recently-assigned person in that role gets the task.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Label htmlFor={`step-target-${i}`} className="text-[11px] text-muted-foreground">
                            Target stage
                          </Label>
                          <Select
                            value={step.moveTargetStageId}
                            onValueChange={(v) => patchStep(i, { moveTargetStageId: v })}
                            disabled={!canManage}
                          >
                            <SelectTrigger id={`step-target-${i}`} className="h-11 w-full sm:w-64 lg:h-9">
                              <SelectValue placeholder="Pick a stage…" />
                            </SelectTrigger>
                            <SelectContent>
                              {stages.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {problem ? (
                        <p className={cn("text-xs", "text-destructive")} role="alert">
                          {problem}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div>
              <Label htmlFor="seq-active" className="text-sm font-medium">
                Active
              </Label>
              <p className="text-[11px] text-muted-foreground">Paused sequences do not fire for new entries.</p>
            </div>
            <Switch
              id="seq-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={!canManage}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-11 lg:h-9" disabled={hasProblem || busy || !canManage} onClick={() => void save()}>
            {busy ? "Saving…" : seq ? "Save changes" : "Create sequence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
