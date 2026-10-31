"use client";

/**
 * Pipeline settings — configure the stages that make up the follow-up funnel.
 * Stages extend the fixed lifecycle enum; the optional mapping keeps each
 * person's lifecycleStage + StageHistory in sync as they move. Editing is
 * gated on pipeline.manage (read-only otherwise).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { canDo, STAGE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorBlock, LoadingBlock, useApiQuery, type ModuleProps } from "@/components/app/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Info, Plus, ShieldAlert, Trash2 } from "lucide-react";
import {
  PIPELINE_COLORS,
  stageDotClass,
  type PipelineStage,
  type PipelineStagesResp,
  errMessage,
} from "./pipeline-shared";

/** Lifecycle values the server accepts for mapping (archived excluded). */
const LIFECYCLE_OPTIONS = ["guest", "returning_guest", "attender", "member", "leader", "inactive"] as const;

interface StageDraft {
  name: string;
  color: string;
  mapsToLifecycleStage: string; // "none" | lifecycle value
  stallThresholdDays: number;
  isActive: boolean;
}

function draftFromStage(s: PipelineStage): StageDraft {
  return {
    name: s.name,
    color: s.color,
    mapsToLifecycleStage: s.mapsToLifecycleStage ?? "none",
    stallThresholdDays: s.stallThresholdDays,
    isActive: s.isActive,
  };
}

function isDirty(s: PipelineStage, drafts: Record<string, StageDraft>): boolean {
  const d = drafts[s.id];
  if (!d) return false;
  return (
    d.name !== s.name ||
    d.color !== s.color ||
    d.mapsToLifecycleStage !== (s.mapsToLifecycleStage ?? "none") ||
    d.stallThresholdDays !== s.stallThresholdDays ||
    d.isActive !== s.isActive
  );
}

export default function PipelineSettingsTab({ user }: ModuleProps) {
  const qc = useQueryClient();
  const canManage = canDo(user, "pipeline.manage");
  const stagesQ = useApiQuery<PipelineStagesResp>(["pipeline", "stages"], "/pipeline/stages");

  const [drafts, setDrafts] = useState<Record<string, StageDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const stages = stagesQ.data?.items ?? [];

  function patchDraft(s: PipelineStage, patch: Partial<StageDraft>) {
    setDrafts((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] ?? draftFromStage(s)), ...patch } }));
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["pipeline"] });
  }

  async function saveStage(s: PipelineStage) {
    const d = drafts[s.id];
    if (!d) return;
    if (!d.name.trim()) {
      toast.error("Stage name is required.");
      return;
    }
    setSavingId(s.id);
    try {
      // sortOrder passed through — the server would otherwise reset it to 0
      await api.post("/pipeline/stages", {
        id: s.id,
        name: d.name.trim(),
        sortOrder: s.sortOrder,
        color: d.color,
        mapsToLifecycleStage: d.mapsToLifecycleStage === "none" ? null : d.mapsToLifecycleStage,
        stallThresholdDays: d.stallThresholdDays,
        isActive: d.isActive,
      });
      toast.success(`Stage “${d.name.trim()}” saved.`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
      await refresh();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setSavingId(null);
    }
  }

  async function removeStage(s: PipelineStage) {
    setDeletingId(s.id);
    try {
      await api.del(`/pipeline/stages/${s.id}`);
      toast.success(`Stage “${s.name}” deleted.`);
      await refresh();
    } catch (err) {
      // server guards: occupied stage / attached to a sequence — message is clear
      toast.error(errMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {!canManage ? (
        <Alert>
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertDescription className="text-sm">
            You can view the pipeline configuration, but only leaders with the “pipeline.manage” permission can change it.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* stage table */}
      {stagesQ.isLoading ? (
        <LoadingBlock label="Loading stages…" />
      ) : stagesQ.isError ? (
        <ErrorBlock error={stagesQ.error} />
      ) : stages.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">No pipeline stages configured yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {canManage
              ? "Create the stages of your follow-up funnel — e.g. First-time guest → Connected → Growing → Sent."
              : "Ask a leader with pipeline.manage access to set up the follow-up funnel."}
          </p>
          {canManage ? (
            <Button className="mt-4 h-11 lg:h-9" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> New stage
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {canManage ? (
            <div className="flex justify-end">
              <Button className="h-11 lg:h-9" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" /> New stage
              </Button>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-xl border scroll-slim">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-56">Name</TableHead>
                  <TableHead className="w-36">Color</TableHead>
                  <TableHead className="w-44">Maps to lifecycle</TableHead>
                  <TableHead className="w-28">Stalls after</TableHead>
                  <TableHead className="w-16">Active</TableHead>
                  <TableHead className="w-20 text-right">People</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map((s) => {
                  const d = drafts[s.id] ?? draftFromStage(s);
                  const dirty = isDirty(s, drafts);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Input
                          value={d.name}
                          onChange={(e) => patchDraft(s, { name: e.target.value })}
                          disabled={!canManage}
                          aria-label={`Name of stage ${s.name}`}
                          className="h-11 lg:h-9"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={d.color}
                          onValueChange={(v) => patchDraft(s, { color: v })}
                          disabled={!canManage}
                        >
                          <SelectTrigger aria-label={`Color of stage ${s.name}`} className="h-11 w-full lg:h-9">
                            <span className="flex items-center gap-2">
                              <span className={cn("h-2.5 w-2.5 rounded-full", stageDotClass(d.color))} aria-hidden />
                              <span className="capitalize">{d.color}</span>
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {PIPELINE_COLORS.map((c) => (
                              <SelectItem key={c} value={c}>
                                <span className="flex items-center gap-2">
                                  <span className={cn("h-2.5 w-2.5 rounded-full", stageDotClass(c))} aria-hidden />
                                  <span className="capitalize">{c}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={d.mapsToLifecycleStage}
                          onValueChange={(v) => patchDraft(s, { mapsToLifecycleStage: v })}
                          disabled={!canManage}
                        >
                          <SelectTrigger aria-label={`Lifecycle mapping of stage ${s.name}`} className="h-11 w-full lg:h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {LIFECYCLE_OPTIONS.map((l) => (
                              <SelectItem key={l} value={l}>
                                {STAGE_LABELS[l]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            value={d.stallThresholdDays}
                            onChange={(e) => {
                              const n = e.target.valueAsNumber;
                              patchDraft(s, { stallThresholdDays: Number.isFinite(n) ? Math.max(1, Math.min(365, Math.round(n))) : 14 });
                            }}
                            disabled={!canManage}
                            aria-label={`Stall threshold in days for stage ${s.name}`}
                            className="h-11 w-20 lg:h-9"
                          />
                          <span className="text-xs text-muted-foreground">days</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={d.isActive}
                          onCheckedChange={(v) => patchDraft(s, { isActive: v })}
                          disabled={!canManage}
                          aria-label={`${d.isActive ? "Deactivate" : "Activate"} stage ${s.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.peopleCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage ? (
                            <>
                              <Button
                                size="sm"
                                className="h-11 lg:h-8"
                                disabled={!dirty || savingId === s.id}
                                onClick={() => void saveStage(s)}
                                aria-label={`Save stage ${s.name}`}
                              >
                                {savingId === s.id ? "Saving…" : dirty ? "Save" : "Saved"}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9 lg:w-9"
                                    aria-label={`Delete stage ${s.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete stage “{s.name}”?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Stages can only be deleted when empty and not used by any sequence — the server
                                      will refuse otherwise and tell you what to move first.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-white hover:bg-destructive/90"
                                      disabled={deletingId === s.id}
                                      onClick={() => void removeStage(s)}
                                    >
                                      {deletingId === s.id ? "Deleting…" : "Delete stage"}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] capitalize">{s.color}</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* model explainer */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info className="h-4 w-4 text-muted-foreground" aria-hidden /> How the pipeline model works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 text-sm text-muted-foreground">
          <p>
            Pipeline stages extend the fixed lifecycle enum (Guest → Returning guest → Attender → Member → Leader →
            Inactive) with your church's own follow-up funnel, so the board can be as granular as you need.
          </p>
          <p>
            Mapping a stage to a lifecycle value keeps each person's lifecycleStage and StageHistory in sync
            automatically — when someone moves on the board, their church-wide lifecycle updates too.
          </p>
          <p>
            “Stalls after N days” drives the amber <span className="font-medium text-foreground">Stalled</span> badge on
            the board and the Needs Attention counts.
          </p>
        </CardContent>
      </Card>

      {newOpen ? (
        <NewStageDialog
          onClose={() => setNewOpen(false)}
          onSaved={async () => {
            setNewOpen(false);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ── new stage dialog ─────────────────────────────────────────────────────────

function NewStageDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PIPELINE_COLORS[0]);
  const [mapsTo, setMapsTo] = useState("none");
  const [days, setDays] = useState(14);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post("/pipeline/stages", {
        name: name.trim(),
        color,
        mapsToLifecycleStage: mapsTo === "none" ? null : mapsTo,
        stallThresholdDays: days,
        isActive,
      });
      toast.success(`Stage “${name.trim()}” created.`);
      await onSaved();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New pipeline stage</DialogTitle>
          <DialogDescription>
            Stages appear as columns on the board in the order they are created.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="stage-name">Name</Label>
            <Input
              id="stage-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Connected"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stage-color">Color</Label>
              <Select value={color} onValueChange={setColor}>
                <SelectTrigger id="stage-color" className="w-full" aria-label="Stage color">
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", stageDotClass(color))} aria-hidden />
                    <span className="capitalize">{color}</span>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_COLORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", stageDotClass(c))} aria-hidden />
                        <span className="capitalize">{c}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stage-days">Stalls after (days)</Label>
              <Input
                id="stage-days"
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  setDays(Number.isFinite(n) ? Math.max(1, Math.min(365, Math.round(n))) : 14);
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stage-maps">Maps to lifecycle (optional)</Label>
            <Select value={mapsTo} onValueChange={setMapsTo}>
              <SelectTrigger id="stage-maps" className="w-full" aria-label="Lifecycle mapping">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {LIFECYCLE_OPTIONS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {STAGE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Keeps each person's lifecycleStage and StageHistory in sync when they pass through this stage.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <Label htmlFor="stage-active" className="text-sm font-medium">
              Active
            </Label>
            <Switch id="stage-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 lg:h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-11 lg:h-9" disabled={!name.trim() || busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create stage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
