"use client";

/**
 * Journey — a person's pipeline position + touchpoint timeline.
 * Used standalone as a dialog (Kanban board) and embedded as a panel inside
 * the People module's person detail dialog via `JourneyPanel`.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorBlock, LoadingBlock, useApiQuery } from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2,
  Footprints,
  Handshake,
  MessageSquare,
  MoveRight,
  Phone,
  Plus,
  SkipForward,
  type LucideIcon,
} from "lucide-react";
import {
  METHOD_LABELS,
  NOTE_METHODS,
  errMessage,
  stageDotClass,
  type JourneyEntry,
  type JourneyResp,
  type NoteMethod,
} from "./pipeline-shared";

// ── helpers ──────────────────────────────────────────────────────────────────

function entryIcon(entry: JourneyEntry): LucideIcon {
  if (entry.kind === "task") return entry.method === "skipped" ? SkipForward : CheckCircle2;
  switch (entry.method) {
    case "call":
      return Phone;
    case "visit":
      return Footprints;
    case "in_person":
      return Handshake;
    default:
      return MessageSquare;
  }
}

function entryLabel(entry: JourneyEntry): string {
  if (entry.kind === "task") return entry.method === "skipped" ? "Task skipped" : "Task completed";
  return METHOD_LABELS[entry.method as NoteMethod] ?? "Note";
}

// ── panel (shared body) ──────────────────────────────────────────────────────

/**
 * The journey body. `canMove` shows the "Move to next stage" button — the
 * move itself is always server-enforced (leadership roles only).
 */
export function JourneyPanel({ personId, canMove = true }: { personId: string; canMove?: boolean }) {
  const qc = useQueryClient();
  const q = useApiQuery<JourneyResp>(
    ["pipeline", "journey", personId],
    `/pipeline/journey/${personId}`,
    { enabled: !!personId },
  );
  const [moving, setMoving] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [method, setMethod] = useState<NoteMethod>("call");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const data = q.data;

  async function refresh() {
    // journey + board + needs-attention all change on a move or a touchpoint
    await qc.invalidateQueries({ queryKey: ["pipeline"] });
  }

  async function moveNext() {
    if (moving) return;
    setMoving(true);
    try {
      await api.post("/pipeline/move-next", { personId });
      toast.success(`${data?.personName ?? "Person"} moved to the next stage.`);
      await refresh();
    } catch (err) {
      // surfaces "Already in the last pipeline stage." / 403 messages verbatim
      toast.error(errMessage(err));
    } finally {
      setMoving(false);
    }
  }

  async function saveNote() {
    if (!note.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await api.post("/pipeline/notes", { personId, method, note: note.trim() });
      toast.success("Touchpoint logged.");
      setNote("");
      setShowNoteForm(false);
      await refresh();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setSavingNote(false);
    }
  }

  if (q.isLoading) {
    return <LoadingBlock label="Loading journey…" />;
  }
  if (q.isError) {
    return <ErrorBlock error={q.error} />;
  }

  const position = data?.position ?? null;
  const timeline = data?.timeline ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">{data?.personName ?? "Person"}</p>

      {/* current position */}
      <div className="rounded-lg border bg-muted/30 p-3">
        {position ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", stageDotClass(position.stageColor))}
              aria-hidden
            />
            <span className="text-sm font-medium">{position.stageName}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {position.daysInStage}d in stage
            </span>
            {position.stalled ? (
              <Badge
                variant="outline"
                className="border-transparent bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              >
                Stalled
              </Badge>
            ) : null}
            {position.enteredBy ? (
              <span className="w-full text-xs text-muted-foreground sm:w-auto">
                Entered by {position.enteredBy}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not in the pipeline yet — “Move to next stage” adds them to the first stage.
          </p>
        )}
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2">
        {canMove ? (
          <Button
            size="sm"
            variant="outline"
            className="h-11 lg:h-8"
            onClick={() => void moveNext()}
            disabled={moving}
          >
            <MoveRight className="h-3.5 w-3.5" /> {moving ? "Moving…" : "Move to next stage"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={showNoteForm ? "secondary" : "outline"}
          className="h-11 lg:h-8"
          onClick={() => setShowNoteForm((v) => !v)}
          aria-expanded={showNoteForm}
        >
          <Plus className="h-3.5 w-3.5" /> Log a touchpoint
        </Button>
      </div>

      {/* inline touchpoint form */}
      {showNoteForm ? (
        <form
          className="space-y-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="journey-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as NoteMethod)}>
              <SelectTrigger id="journey-method" className="h-11 w-full lg:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTE_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journey-note">What happened?</Label>
            <Textarea
              id="journey-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Spoke with her on the phone — curious about the youth group."
              className="min-h-[72px]"
              aria-label="Touchpoint note"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" className="h-11 lg:h-8" disabled={!note.trim() || savingNote}>
              {savingNote ? "Saving…" : "Save touchpoint"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-11 lg:h-8"
              onClick={() => {
                setShowNoteForm(false);
                setNote("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {/* timeline */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Touchpoint history
        </h4>
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No touchpoints logged yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l pl-4">
            {timeline.map((entry) => {
              const Icon = entryIcon(entry);
              return (
                <li key={`${entry.kind}-${entry.id}`} className="relative">
                  <span
                    className="absolute -left-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-muted"
                    aria-hidden
                  >
                    <Icon className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-medium">{entryLabel(entry)}</span>
                    <span className="text-[11px] text-muted-foreground">{fmtDateTime(entry.at)}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.text}</p>
                  <p className="text-[11px] text-muted-foreground/80">by {entry.by}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── standalone dialog (kanban board) ─────────────────────────────────────────

export default function JourneyDialog({ personId, onClose }: { personId: string | null; onClose: () => void }) {
  return (
    <Dialog open={personId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scroll-slim sm:max-w-lg" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Person journey</DialogTitle>
        <DialogDescription className="sr-only">
          Pipeline position and touchpoint history for this person.
        </DialogDescription>
        {personId ? <JourneyPanel key={personId} personId={personId} /> : null}
      </DialogContent>
    </Dialog>
  );
}
