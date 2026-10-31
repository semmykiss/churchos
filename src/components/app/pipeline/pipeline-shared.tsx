"use client";

/**
 * Shared shapes + tiny display helpers for the Follow-up Pipeline module.
 * Types mirror the live /api/v1/pipeline/* contract (frontend only).
 * Kept in its own file so tabs never import runtime code from the module
 * shell (no import cycles) — same pattern as partner-shared.tsx.
 */

// ── API shapes ───────────────────────────────────────────────────────────────

export interface PipelineStage {
  id: string;
  name: string;
  sortOrder: number;
  mapsToLifecycleStage: string | null;
  color: string;
  stallThresholdDays: number;
  isActive: boolean;
  peopleCount: number;
}

export interface PipelineStagesResp {
  items: PipelineStage[];
}

export interface BoardCard {
  personId: string;
  name: string;
  lifecycleStage: string;
  enteredStageAt: string;
  daysInStage: number;
  stalled: boolean;
}

export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  mapsToLifecycleStage: string | null;
  stallThresholdDays: number;
  stalledCount: number;
  cards: BoardCard[];
}

export interface BoardResp {
  columns: BoardColumn[];
}

export type StepActionType = "auto_message" | "assign_task" | "move_stage";

export interface SequenceStep {
  id: string;
  sequenceId: string;
  dayOffset: number;
  actionType: StepActionType;
  channel: string | null;
  messageTemplate: string | null;
  assignToRole: string | null;
  moveTargetStageId: string | null;
  sortOrder: number;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  triggerStage: { id: string; name: string } | null;
  isActive: boolean;
  steps: SequenceStep[];
}

export interface SequencesResp {
  items: Sequence[];
}

/** POST /pipeline/sequences body — exact contract shape (numbers as numbers). */
export interface SequenceSaveStep {
  dayOffset: number;
  actionType: StepActionType;
  channel?: string | null;
  messageTemplate?: string | null;
  assignToRole?: string | null;
  moveTargetStageId?: string | null;
}

export interface SequenceSavePayload {
  id?: string;
  name: string;
  description?: string;
  triggerStageId?: string | null;
  isActive?: boolean;
  steps: SequenceSaveStep[];
}

export type TaskStatus = "pending" | "completed" | "skipped" | "overdue";

export interface FollowUpTask {
  id: string;
  personId: string;
  personName: string;
  sequenceName: string | null;
  title: string;
  assignedToName: string | null;
  dueDate: string;
  status: TaskStatus;
  completedAt: string | null;
  outcomeNote: string | null;
  createdAt: string;
}

export interface TasksResp {
  scope: "all" | "own";
  items: FollowUpTask[];
}

export interface StalledPerson {
  personId: string;
  name: string;
  stageName: string;
  daysInStage: number;
}

export interface OverdueTask {
  id: string;
  personName: string;
  title: string;
  dueDate: string;
  assignedToName: string | null;
}

export interface NeedsAttentionResp {
  stalledCount: number;
  stalled: StalledPerson[];
  overdueCount: number;
  overdueTasks: OverdueTask[];
}

export interface JourneyPosition {
  stageId: string | null;
  stageName: string;
  stageColor: string | null;
  enteredStageAt: string;
  daysInStage: number;
  stalled: boolean;
  enteredBy: string | null;
}

export interface JourneyEntry {
  kind: "note" | "task";
  id: string;
  at: string;
  method: string;
  text: string;
  by: string;
}

export interface JourneyResp {
  personName: string;
  position: JourneyPosition | null;
  timeline: JourneyEntry[];
}

export interface TickResp {
  messagesSent: number;
  tasksCreated: number;
  stageMoves: number;
  overdueFlagged: number;
  at: string;
}

// ── display helpers ──────────────────────────────────────────────────────────

/** Color tokens the server rotates through for new stages (STAGE_COLORS). */
export const PIPELINE_COLORS = ["emerald", "amber", "violet", "rose", "zinc", "teal"] as const;
export type PipelineColor = (typeof PIPELINE_COLORS)[number];

/** Static Tailwind classes per color token — the server stores the token string. */
const COLOR_DOT: Record<PipelineColor, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  zinc: "bg-zinc-500",
  teal: "bg-teal-500",
};

export function stageDotClass(color?: string | null): string {
  return COLOR_DOT[(color ?? "") as PipelineColor] ?? COLOR_DOT.zinc;
}

export const ACTION_TYPE_LABELS: Record<StepActionType, string> = {
  auto_message: "Send message",
  assign_task: "Assign a task",
  move_stage: "Move to stage",
};

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

export const NOTE_METHODS = ["call", "visit", "message", "in_person"] as const;
export type NoteMethod = (typeof NOTE_METHODS)[number];

export const METHOD_LABELS: Record<NoteMethod, string> = {
  call: "Call",
  visit: "Visit",
  message: "Message",
  in_person: "In person",
};

/** Whole calendar days from today until `iso` (negative = in the past). */
export function daysUntil(iso?: string | null): number {
  if (!iso) return 0;
  const d = new Date(iso);
  const now = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** Human label for a task due date — "Due today", "3 days overdue", … */
export function dueLabel(iso: string): string {
  const n = daysUntil(iso);
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n === -1) return "1 day overdue";
  if (n < 0) return `${-n} days overdue`;
  return `Due in ${n}d`;
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
