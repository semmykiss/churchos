"use client";

/**
 * WhatsApp Flows — structured multi-step conversation sequences (first-timer
 * follow-up, RSVP, giving nudges). Includes the human hand-off queue, the
 * on-demand scheduler and a full flow editor with an ordered step builder.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo, fmtDateTime, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorBlock, LoadingBlock, Section, useApiQuery, type ModuleProps } from "@/components/app/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  Clock,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import type {
  WaContactFields,
  WaContactsResp,
  WaFlow,
  WaFlowsResp,
  WaFlowStep,
  WaRun,
  WaRunsResp,
  WaTemplatesResp,
} from "@/components/app/whatsapp/WhatsAppModule";

/* ───────────────────────── helpers ───────────────────────── */

interface EventOption {
  id: string;
  name: string;
  startsAt: string;
}
interface FundOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  new_visitor: "New visitor",
  event_created: "Event created",
};

const STEP_KIND_LABELS: Record<WaFlowStep["kind"], string> = {
  message: "Message",
  template: "Template",
  question: "Question",
  rsvp: "RSVP",
  give_link: "Giving link",
  assign_followup: "Assign follow-up",
};

function RunStatusBadge({ status }: { status: string }) {
  const cls =
    status === "needs_human"
      ? "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
      : status === "waiting_reply"
        ? "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : status === "scheduled"
          ? "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          : status === "completed"
            ? "border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
            : "border-transparent bg-muted text-muted-foreground"; // active
  return <Badge variant="outline" className={cn("font-medium", cls)}>{status.replace(/_/g, " ")}</Badge>;
}

function canSendWhatsapp(user: SessionUser): boolean {
  return canDo(user, "comms.whatsapp.send") || canDo(user, "comms.send");
}

/* ───────────────────────── tab ───────────────────────── */

export default function FlowsTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const followupsQ = useApiQuery<WaRunsResp>(["whatsapp", "runs", "followups"], "/whatsapp/runs?filter=followups");
  const activeQ = useApiQuery<WaRunsResp>(["whatsapp", "runs", "active"], "/whatsapp/runs?filter=active");
  const flowsQ = useApiQuery<WaFlowsResp>(["whatsapp", "flows"], "/whatsapp/flows");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<WaFlow | null>(null);
  const [deleteFlow, setDeleteFlow] = useState<WaFlow | null>(null);
  const [triggerFlow, setTriggerFlow] = useState<WaFlow | null>(null);
  const [resolveRun, setResolveRun] = useState<WaRun | null>(null);
  const [ticking, setTicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canSend = canSendWhatsapp(user);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["whatsapp"] });
  }

  async function runTick() {
    setTicking(true);
    try {
      const res = await api.post<{ fired: number; triggered: number }>("/whatsapp/tick");
      toast.success(`Fired ${res.fired} scheduled step(s), triggered ${res.triggered} new-visitor flow(s).`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scheduler failed.");
    } finally {
      setTicking(false);
    }
  }

  async function toggleFlow(flow: WaFlow, isActive: boolean) {
    setBusyId(flow.id);
    try {
      await api.post(`/whatsapp/flows/${flow.id}/toggle`, { isActive });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the flow.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeFlow(flow: WaFlow) {
    setBusyId(flow.id);
    try {
      await api.del(`/whatsapp/flows/${flow.id}`);
      toast.success("Flow deleted.");
      setDeleteFlow(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  const followups = followupsQ.data?.items ?? [];
  const activeRuns = activeQ.data?.items ?? [];
  const flows = flowsQ.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Section
        title="Follow-ups queue"
        description="Runs that hit a human hand-off step and need a person to close the loop."
        actions={
          canSend ? (
            <Button variant="outline" className="h-11 lg:h-9" onClick={runTick} disabled={ticking}>
              {ticking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} Run scheduler
            </Button>
          ) : null
        }
      >
        {followupsQ.isLoading ? (
          <LoadingBlock label="Loading follow-ups…" />
        ) : followupsQ.isError ? (
          <ErrorBlock error={followupsQ.error} />
        ) : followups.length === 0 ? (
          <EmptyState icon={CheckCheck} title="No follow-ups waiting" description="Everything assigned to humans has been handled." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {followups.map((r) => (
              <Card key={r.id} className="py-0">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.personName}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.flowName}</p>
                    </div>
                    <RunStatusBadge status={r.status} />
                  </div>
                  {r.context?.followup_note && (
                    <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">{r.context.followup_note}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Waiting since {fmtDateTime(r.lastActivityAt)}</p>
                  {canSend && (
                    <Button variant="outline" size="sm" className="h-11 w-full lg:h-9" onClick={() => setResolveRun(r)}>
                      <CheckCheck className="h-4 w-4" /> Mark handled
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Active runs" description="Every flow currently walking a contact through its steps.">
        {activeQ.isLoading ? (
          <LoadingBlock label="Loading runs…" />
        ) : activeQ.isError ? (
          <ErrorBlock error={activeQ.error} />
        ) : activeRuns.length === 0 ? (
          <EmptyState icon={Workflow} title="No active runs" description="Start a flow manually below, or let the scheduler trigger them." />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <ul className="scroll-slim max-h-96 divide-y overflow-y-auto" role="list">
              {activeRuns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.personName} <span className="font-normal text-muted-foreground">· {r.flowName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Step {r.currentStep + 1}
                      {r.nextStepAt ? ` · next step ${fmtDateTime(r.nextStepAt)}` : " · waiting for a reply"}
                    </p>
                  </div>
                  <RunStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title="Flows"
        description="Sequences triggered manually, by first-time attendance, or when an event is created."
        actions={
          canSend ? (
            <Button
              className="h-11 lg:h-9"
              onClick={() => {
                setEditingFlow(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New flow
            </Button>
          ) : null
        }
      >
        {flowsQ.isLoading ? (
          <LoadingBlock label="Loading flows…" />
        ) : flowsQ.isError ? (
          <ErrorBlock error={flowsQ.error} />
        ) : flows.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No flows yet"
            description="Create your first flow — e.g. a three-step welcome sequence for first-time guests."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {flows.map((f) => (
              <Card key={f.id} className="py-0">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{f.name}</p>
                      {f.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.description}</p>}
                    </div>
                    <Badge variant="outline" className="shrink-0 border-transparent bg-muted font-medium text-muted-foreground">
                      {TRIGGER_LABELS[f.triggerType] ?? f.triggerType}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {f.steps.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No steps yet</span>
                    ) : (
                      f.steps.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] font-normal">
                          {i + 1}. {STEP_KIND_LABELS[s.kind] ?? s.kind}
                        </Badge>
                      ))
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
                      <Switch
                        checked={f.isActive}
                        disabled={!canSend || busyId === f.id}
                        onCheckedChange={(v) => void toggleFlow(f, v)}
                        aria-label={`${f.isActive ? "Deactivate" : "Activate"} flow ${f.name}`}
                      />
                      <span className="text-xs text-muted-foreground">{f.isActive ? "Active" : "Paused"} · {f.runCount} run(s)</span>
                    </label>
                    {canSend && (
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" className="h-11 lg:h-9" onClick={() => setTriggerFlow(f)}>
                          <Play className="h-4 w-4" /> Start
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 lg:h-9"
                          aria-label={`Edit flow ${f.name}`}
                          onClick={() => {
                            setEditingFlow(f);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9 lg:w-9"
                          aria-label={`Delete flow ${f.name}`}
                          onClick={() => setDeleteFlow(f)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* editor */}
      <FlowEditorDialog
        open={editorOpen}
        flow={editingFlow}
        onOpenChange={setEditorOpen}
        onSaved={refresh}
      />

      {/* start for a member */}
      <TriggerFlowDialog flow={triggerFlow} onOpenChange={(o) => !o && setTriggerFlow(null)} onTriggered={refresh} />

      {/* resolve follow-up */}
      <ResolveRunDialog run={resolveRun} onOpenChange={(o) => !o && setResolveRun(null)} onResolved={refresh} />

      {/* delete confirm */}
      <AlertDialog open={!!deleteFlow} onOpenChange={(o) => !o && setDeleteFlow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete flow “{deleteFlow?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Flows with active runs cannot be deleted — let them finish first. The step definitions are removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 lg:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-white hover:bg-destructive/90 lg:h-9"
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault();
                if (deleteFlow) void removeFlow(deleteFlow);
              }}
            >
              {busyId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────── resolve follow-up ───────────────────────── */

function ResolveRunDialog({
  run,
  onOpenChange,
  onResolved,
}: {
  run: WaRun | null;
  onOpenChange: (open: boolean) => void;
  onResolved: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolve() {
    if (!run) return;
    setBusy(true);
    try {
      await api.post(`/whatsapp/runs/${run.id}/resolve`, { note: note.trim() || undefined });
      toast.success(`Follow-up for ${run.personName} marked handled.`);
      setNote("");
      onOpenChange(false);
      await onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve the follow-up.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!run} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark follow-up handled</DialogTitle>
          <DialogDescription>
            {run ? `${run.flowName} for ${run.personName}.` : ""} Optionally note what you did — it is stored on the run.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Called and answered their question about small groups."
          aria-label="Resolution note"
          className="min-h-24"
        />
        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={resolve} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} Mark handled
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── trigger for a member ───────────────────────── */

function TriggerFlowDialog({
  flow,
  onOpenChange,
  onTriggered,
}: {
  flow: WaFlow | null;
  onOpenChange: (open: boolean) => void;
  onTriggered: () => Promise<void>;
}) {
  const contactsQ = useApiQuery<WaContactsResp>(["whatsapp", "contacts"], "/whatsapp/contacts", {
    enabled: !!flow,
  });
  const [contactId, setContactId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const contacts = contactsQ.data?.items ?? [];

  async function trigger() {
    if (!flow || !contactId) return;
    setBusy(true);
    try {
      await api.post("/whatsapp/flows/trigger", { flowId: flow.id, contactId });
      toast.success(`“${flow.name}” started.`);
      setContactId("");
      onOpenChange(false);
      await onTriggered();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the flow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!flow} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start “{flow?.name ?? ""}”</DialogTitle>
          <DialogDescription>Pick the WhatsApp contact this run should walk through the flow.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Contact</Label>
          <Select value={contactId} onValueChange={setContactId}>
            <SelectTrigger className="w-full" aria-label="Contact to start the flow for">
              <SelectValue placeholder="Choose a contact…" />
            </SelectTrigger>
            <SelectContent>
              {contacts.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">No WhatsApp contacts yet.</p>
              )}
              {contacts.map((c: WaContactFields) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.personName || c.displayName || c.phoneNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={trigger} disabled={!contactId || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start flow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── flow editor ───────────────────────── */

/** Editor-facing step: all fields as strings, converted on save. */
interface EditorStep {
  kind: WaFlowStep["kind"];
  text: string;
  templateName: string;
  vars: string;
  delayHours: string;
  key: string;
  choices: string;
  eventId: string;
  fundCode: string;
  introText: string;
  note: string;
}

function emptyStep(): EditorStep {
  return {
    kind: "message",
    text: "",
    templateName: "",
    vars: "",
    delayHours: "",
    key: "",
    choices: "",
    eventId: "",
    fundCode: "",
    introText: "",
    note: "",
  };
}

function toEditorStep(s: WaFlowStep): EditorStep {
  return {
    kind: s.kind,
    text: s.text ?? "",
    templateName: s.templateName ?? "",
    vars: (s.vars ?? []).join(", "),
    delayHours: s.delayHours != null ? String(s.delayHours) : "",
    key: s.key ?? "",
    choices: (s.choices ?? []).join(", "),
    eventId: s.eventId ?? "",
    fundCode: s.fundCode ?? "",
    introText: s.introText ?? "",
    note: s.note ?? "",
  };
}

function toApiStep(s: EditorStep): WaFlowStep {
  const delay = Number(s.delayHours);
  const delayHours = Number.isFinite(delay) && delay > 0 ? delay : undefined;
  const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const base: WaFlowStep = { kind: s.kind };
  switch (s.kind) {
    case "message":
      return { ...base, text: s.text, ...(delayHours !== undefined && { delayHours }) };
    case "template":
      return {
        ...base,
        templateName: s.templateName,
        ...(s.vars.trim() ? { vars: list(s.vars) } : {}),
        ...(delayHours !== undefined && { delayHours }),
      };
    case "question":
      return { ...base, key: s.key, text: s.text, ...(s.choices.trim() ? { choices: list(s.choices) } : {}) };
    case "rsvp":
      return { ...base, eventId: s.eventId, ...(s.text.trim() ? { text: s.text.trim() } : {}) };
    case "give_link":
      return {
        ...base,
        ...(s.fundCode ? { fundCode: s.fundCode } : {}),
        ...(s.introText.trim() ? { introText: s.introText.trim() } : {}),
      };
    case "assign_followup":
      return { ...base, ...(s.note.trim() ? { note: s.note.trim() } : {}) };
  }
}

function FlowEditorDialog({
  open,
  flow,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  flow: WaFlow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const eventsQ = useApiQuery<{ items: EventOption[] }>(["whatsapp", "events"], "/events", { enabled: open });
  const fundsQ = useApiQuery<{ items: FundOption[] }>(["whatsapp", "funds"], "/funds", { enabled: open });
  const templatesQ = useApiQuery<WaTemplatesResp>(["whatsapp", "templates"], "/whatsapp/templates", { enabled: open });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<string>("manual");
  const [eventId, setEventId] = useState<string>("");
  const [steps, setSteps] = useState<EditorStep[]>([emptyStep()]);
  const [saving, setSaving] = useState(false);

  // hydrate when (re)opened
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const hydrateKey = open ? (flow?.id ?? "new") : null;
  if (open && hydrateKey !== null && hydratedFor !== hydrateKey) {
    setHydratedFor(hydrateKey);
    if (flow) {
      setName(flow.name);
      setDescription(flow.description ?? "");
      setTriggerType(flow.triggerType);
      setEventId(flow.eventId ?? "");
      setSteps(flow.steps.length > 0 ? flow.steps.map(toEditorStep) : [emptyStep()]);
    } else {
      setName("");
      setDescription("");
      setTriggerType("manual");
      setEventId("");
      setSteps([emptyStep()]);
    }
  }
  if (!open && hydratedFor !== null) setHydratedFor(null);

  const events = eventsQ.data?.items ?? [];
  const funds = (fundsQ.data?.items ?? []).filter((f) => f.isActive);
  const approvedTemplates = (templatesQ.data?.items ?? []).filter((t) => t.status === "approved");

  function updateStep(index: number, patch: Partial<EditorStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Flow name is required.");
      return;
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const label = `Step ${i + 1}`;
      if (s.kind === "message" && !s.text.trim()) {
        toast.error(`${label}: message text is required.`);
        return;
      }
      if (s.kind === "template" && !s.templateName) {
        toast.error(`${label}: pick a template.`);
        return;
      }
      if (s.kind === "question" && (!s.key.trim() || !s.text.trim())) {
        toast.error(`${label}: questions need a key and prompt text.`);
        return;
      }
      if (s.kind === "rsvp" && !s.eventId) {
        toast.error(`${label}: RSVP steps need an event.`);
        return;
      }
    }
    if (triggerType === "event_created" && !eventId) {
      toast.error("Pick the event that triggers this flow.");
      return;
    }

    setSaving(true);
    try {
      await api.post("/whatsapp/flows", {
        ...(flow ? { id: flow.id } : {}),
        name: name.trim(),
        description: description.trim() || undefined,
        triggerType,
        ...(triggerType === "event_created" ? { eventId } : {}),
        ...(flow ? { isActive: flow.isActive } : {}),
        steps: steps.map(toApiStep),
      });
      toast.success(flow ? "Flow updated." : "Flow created.");
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the flow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scroll-slim sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{flow ? "Edit flow" : "New flow"}</DialogTitle>
          <DialogDescription>
            Steps run in order. Message and template steps can wait (delayHours); question and RSVP steps pause for the member's reply.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wa-flow-name">Name</Label>
              <Input id="wa-flow-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First-visit welcome" />
            </div>
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger className="w-full" aria-label="Flow trigger type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual — started by a staff member</SelectItem>
                  <SelectItem value="new_visitor">New visitor — first-time attendance</SelectItem>
                  <SelectItem value="event_created">Event created</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {triggerType === "event_created" && (
            <div className="space-y-1.5">
              <Label>Event</Label>
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger className="w-full" aria-label="Triggering event">
                  <SelectValue placeholder="Choose the event…" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      {ev.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wa-flow-desc">Description (optional)</Label>
            <Input
              id="wa-flow-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this flow accomplish?"
            />
          </div>

          {/* step builder */}
          <div className="space-y-3">
            <Label>Steps</Label>
            {steps.map((s, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step {i + 1}</span>
                  <Select
                    value={s.kind}
                    onValueChange={(v) => updateStep(i, { kind: v as EditorStep["kind"] })}
                  >
                    <SelectTrigger className="h-9 w-44" aria-label={`Step ${i + 1} kind`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STEP_KIND_LABELS) as WaFlowStep["kind"][]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {STEP_KIND_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`Move step ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => moveStep(i, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`Move step ${i + 1} down`}
                      disabled={i === steps.length - 1}
                      onClick={() => moveStep(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove step ${i + 1}`}
                      disabled={steps.length === 1}
                      onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* per-kind fields */}
                {s.kind === "message" && (
                  <div className="space-y-2.5">
                    <Textarea
                      value={s.text}
                      onChange={(e) => updateStep(i, { text: e.target.value })}
                      placeholder="Message text…"
                      aria-label={`Step ${i + 1} message text`}
                      className="min-h-20"
                    />
                    <DelayHoursField value={s.delayHours} onChange={(v) => updateStep(i, { delayHours: v })} />
                  </div>
                )}

                {s.kind === "template" && (
                  <div className="space-y-2.5">
                    <Select value={s.templateName} onValueChange={(v) => updateStep(i, { templateName: v })}>
                      <SelectTrigger className="w-full" aria-label={`Step ${i + 1} template`}>
                        <SelectValue placeholder="Approved template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {approvedTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.name}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={s.vars}
                      onChange={(e) => updateStep(i, { vars: e.target.value })}
                      placeholder="Template variables, comma-separated ({{1}}, {{2}}…)"
                      aria-label={`Step ${i + 1} template variables`}
                    />
                    <DelayHoursField value={s.delayHours} onChange={(v) => updateStep(i, { delayHours: v })} />
                  </div>
                )}

                {s.kind === "question" && (
                  <div className="space-y-2.5">
                    <Input
                      value={s.key}
                      onChange={(e) => updateStep(i, { key: e.target.value })}
                      placeholder="Answer key, e.g. preferred_campus"
                      aria-label={`Step ${i + 1} answer key`}
                    />
                    <Textarea
                      value={s.text}
                      onChange={(e) => updateStep(i, { text: e.target.value })}
                      placeholder="Question text…"
                      aria-label={`Step ${i + 1} question text`}
                      className="min-h-16"
                    />
                    <Input
                      value={s.choices}
                      onChange={(e) => updateStep(i, { choices: e.target.value })}
                      placeholder="Choices, comma-separated (max 4), e.g. Yes, No, Maybe"
                      aria-label={`Step ${i + 1} choices`}
                    />
                  </div>
                )}

                {s.kind === "rsvp" && (
                  <div className="space-y-2.5">
                    <Select value={s.eventId} onValueChange={(v) => updateStep(i, { eventId: v })}>
                      <SelectTrigger className="w-full" aria-label={`Step ${i + 1} event`}>
                        <SelectValue placeholder="Event to RSVP for…" />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map((ev) => (
                          <SelectItem key={ev.id} value={ev.id}>
                            {ev.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      value={s.text}
                      onChange={(e) => updateStep(i, { text: e.target.value })}
                      placeholder="Invite text (optional — defaults to the event name and date)"
                      aria-label={`Step ${i + 1} RSVP text`}
                      className="min-h-16"
                    />
                  </div>
                )}

                {s.kind === "give_link" && (
                  <div className="space-y-2.5">
                    <Select value={s.fundCode} onValueChange={(v) => updateStep(i, { fundCode: v })}>
                      <SelectTrigger className="w-full" aria-label={`Step ${i + 1} fund`}>
                        <SelectValue placeholder="Fund (optional)…" />
                      </SelectTrigger>
                      <SelectContent>
                        {funds.map((f) => (
                          <SelectItem key={f.id} value={f.code}>
                            {f.name} ({f.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={s.introText}
                      onChange={(e) => updateStep(i, { introText: e.target.value })}
                      placeholder="Intro text (optional) shown above the giving link"
                      aria-label={`Step ${i + 1} giving link intro`}
                    />
                  </div>
                )}

                {s.kind === "assign_followup" && (
                  <Input
                    value={s.note}
                    onChange={(e) => updateStep(i, { note: e.target.value })}
                    placeholder="Note for the team member picking this up"
                    aria-label={`Step ${i + 1} follow-up note`}
                  />
                )}
              </div>
            ))}

            <Button
              variant="outline"
              className="h-11 w-full border-dashed lg:h-9"
              onClick={() => setSteps((prev) => [...prev, emptyStep()])}
            >
              <Plus className="h-4 w-4" /> Add step
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 bg-emerald-700 hover:bg-emerald-800 lg:h-9" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {flow ? "Save changes" : "Create flow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DelayHoursField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Input
        type="number"
        min={0}
        step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Hours to wait before sending (optional)"
        aria-label="Hours to wait before sending"
        className="w-full sm:w-72"
      />
      <p className="text-[11px] text-muted-foreground">Leave empty to send immediately.</p>
    </div>
  );
}
