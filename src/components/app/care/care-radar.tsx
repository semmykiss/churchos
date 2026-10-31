"use client";

/**
 * Care Radar (Feature 2) — decision-support for pastoral care, never surveillance.
 * • Deterministic, explainable signals: every flag shows exact plain-language
 *   reasoning; no opaque scores.
 * • Giving-derived amounts only render for viewers holding giving.view.all
 *   (server strips restricted details for everyone else).
 * • Every action (acknowledge / progress / resolve / dismiss / assign) is an
 *   explicit human click — nothing automated ever contacts a member.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/types";
import { toast } from "sonner";
import { EmptyState, LoadingBlock, ErrorBlock, PersonAvatar } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Radar, RefreshCw, Eye, CheckCheck, CircleDot, UserRoundCheck,
  Ban, Settings2, TrendingDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

interface FlagRow {
  id: string;
  person: { id: string; name: string; lifecycleStage: string; photoUrl?: string | null };
  riskLevel: "watch" | "elevated" | "urgent";
  status: string;
  computedAt: string;
  topSignals: { type: string; severity: number; detail: string }[];
  signalCount: number;
}
interface FlagsResp { items: FlagRow[]; scope: "all" | "led_groups" }
interface FlagDetail {
  flag: { id: string; person: { id: string; name: string } | null; riskLevel: string; status: string; computedAt: string; acknowledgedAt?: string | null; acknowledgedByName?: string | null; resolutionNote?: string | null; resolvedAt?: string | null };
  signals: { type: string; severity: number; detail: string; detailRestricted?: string }[];
  showsAmounts: boolean;
  trend: { attendance: { at: string; present: boolean }[]; giving: { month: string; totalCents: number }[] };
  history: { id: string; riskLevel: string; action: string; actorName?: string | null; note?: string | null; createdAt: string }[];
}
interface RuleRow { id: string; signalType: string; enabled: boolean; weight: number; thresholds: Record<string, number> }

export const LEVEL_TONE: Record<string, string> = {
  urgent: "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  elevated: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  watch: "border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

// ── entry (mounted as a tab inside the Care module) ──────────────────────────
export default function CareRadarTab({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("open");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const flagsQ = useQuery({
    queryKey: ["risk", "flags", status],
    queryFn: () => api.get<FlagsResp>(`/risk/flags${qs({ status })}`),
  });

  const recalcMut = useMutation({
    mutationFn: (force: boolean) => api.post<{ ran: boolean; created: number; escalated: number; cleared: number; suggestedTasks: number }>("/risk/recalculate", { force }),
    onSuccess: (r) => {
      if (r.ran) {
        toast.success(`Recalculated — ${r.created} new flag(s), ${r.escalated} escalated, ${r.cleared} cleared${r.suggestedTasks ? `, ${r.suggestedTasks} follow-up task(s) suggested` : ""}`);
      } else {
        toast.info("Signals were refreshed recently — next automatic pass runs within 6 hours.");
      }
      queryClient.invalidateQueries({ queryKey: ["risk"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const canManage = user.permissions.includes("care.risk.manage") || user.permissions.includes("*");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["open", "new", "acknowledged", "in_progress", "resolved", "dismissed"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
            status === s ? "border-teal-700 bg-teal-700 text-white dark:bg-teal-600 dark:border-teal-600" : "bg-background text-muted-foreground hover:bg-accent",
          )}>{s.replace("_", " ")}</button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {canManage ? (
            <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
              <Settings2 className="h-4 w-4" aria-hidden /> Thresholds
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => recalcMut.mutate(canManage)} disabled={recalcMut.isPending}>
            <RefreshCw className={cn("h-4 w-4", recalcMut.isPending && "animate-spin")} aria-hidden /> Recalculate
          </Button>
        </div>
      </div>

      {flagsQ.data?.scope === "led_groups" ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-info/30 bg-info-bg px-3 py-2 text-xs text-ink-secondary">
          <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
          You are seeing flags only for members of groups you lead.
        </p>
      ) : null}

      {flagsQ.isLoading ? <LoadingBlock label="Scanning signals…" />
        : flagsQ.isError ? <ErrorBlock error={flagsQ.error} />
        : !flagsQ.data?.items.length ? (
          <EmptyState
            icon={Radar}
            title={status === "open" ? "No open risk flags" : "No flags here"}
            description="Care Radar scans attendance, giving patterns and small-group engagement deterministically. Every flag arrives with its full reasoning — nothing is automated."
            action={canManage ? <Button variant="outline" onClick={() => recalcMut.mutate(true)}><RefreshCw className="h-4 w-4" aria-hidden /> Run a scan now</Button> : undefined}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flagsQ.data.items.map((f) => (
              <Card key={f.id} className="group cursor-pointer transition-shadow hover:shadow-md" onClick={() => setDetailId(f.id)}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <PersonAvatar name={f.person.name} className="h-10 w-10 text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold">{f.person.name}</p>
                        <Badge variant="outline" className={cn("capitalize", LEVEL_TONE[f.riskLevel])}>{f.riskLevel}</Badge>
                      </div>
                      <p className="text-[11px] capitalize text-muted-foreground">{f.person.lifecycleStage.replace(/_/g, " ")} · {f.status.replace(/_/g, " ")} · {fmtDate(f.computedAt)}</p>
                      <ul className="mt-2 space-y-1">
                        {f.topSignals.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-ink-secondary">
                            <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
                            <span className="line-clamp-2">{s.detail}</span>
                          </li>
                        ))}
                        {f.signalCount > 2 ? <li className="pl-4 text-[11px] text-muted-foreground">+{f.signalCount - 2} more signal(s)</li> : null}
                      </ul>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      <FlagDetailDialog flagId={detailId} onClose={() => setDetailId(null)} user={user} queryClient={queryClient} />
      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} queryClient={queryClient} />
    </div>
  );
}

// ── flag detail ──────────────────────────────────────────────────────────────
function FlagDetailDialog({ flagId, onClose, user, queryClient }: { flagId: string | null; onClose: () => void; user: SessionUser; queryClient: ReturnType<typeof useQueryClient> }) {
  const [note, setNote] = useState("");
  const detailQ = useQuery({
    queryKey: ["risk", "flag", flagId],
    queryFn: () => api.get<FlagDetail>(`/risk/flags/${flagId}`),
    enabled: !!flagId,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["risk"] });
    onClose();
  }
  const actMut = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) =>
      api.post(`/risk/flags/${flagId}/${action}`, body ?? {}),
    onSuccess: (_r, v) => { toast.success(`Flag ${v.action === "assign-task" ? "follow-up task assigned" : v.action + "ed"}`); invalidate(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const d = detailQ.data;
  const canManage = user.permissions.includes("care.risk.manage") || user.permissions.includes("*");

  return (
    <Dialog open={!!flagId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {d?.flag.person?.name ?? "Risk flag"}
            {d ? <Badge variant="outline" className={cn("capitalize", LEVEL_TONE[d.flag.riskLevel])}>{d.flag.riskLevel}</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            {d
              ? <>Deterministic decision-support — computed {fmtDateTime(d.flag.computedAt)}. A human reviews and acts; nothing is automated.
                {d.showsAmounts ? "" : " Giving amounts are hidden because your role does not include individual giving visibility."}</>
              : "Loading full reasoning…"}
          </DialogDescription>
        </DialogHeader>
        {detailQ.isLoading || !d ? (
          <div className="py-8"><LoadingBlock label="Loading full reasoning…" /></div>
        ) : (
          <>

            <div className="scroll-slim max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this flag exists (exact signals)</h3>
                <ul className="space-y-2">
                  {d.signals.map((s, i) => (
                    <li key={i} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-[10px] capitalize", LEVEL_TONE[s.severity === 3 ? "urgent" : s.severity === 2 ? "elevated" : "watch"])}>
                          {s.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="mt-1.5 leading-relaxed">{d.showsAmounts && s.detailRestricted ? s.detailRestricted : s.detail}</p>
                    </li>
                  ))}
                  {!d.signals.length ? <p className="text-sm text-muted-foreground">Signals no longer meet thresholds — awaiting human review.</p> : null}
                </ul>
              </div>

              {d.trend.attendance.length ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attendance trend (last services)</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {d.trend.attendance.map((a, i) => (
                      <span key={i} title={`${fmtDate(a.at)} — ${a.present ? "present" : "absent"}`}
                        className={cn("rounded px-2 py-1 text-[10px] font-medium", a.present ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
                        {fmtDate(a.at).slice(0, 6)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {d.trend.giving.length ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Giving trend (monthly, visible to you)</h3>
                  <div className="space-y-1">
                    {d.trend.giving.map((g) => {
                      const max = Math.max(...d.trend.giving.map((x) => x.totalCents), 1);
                      return (
                        <div key={g.month} className="flex items-center gap-2 text-xs">
                          <span className="w-14 text-muted-foreground">{g.month}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.round((g.totalCents / max) * 100)}%` }} />
                          </div>
                          <span className="w-20 text-right font-medium">₦{(g.totalCents / 100).toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History (append-only audit trail)</h3>
                <ol className="space-y-2 border-l pl-4">
                  {d.history.map((h) => (
                    <li key={h.id} className="text-xs">
                      <p><span className="font-semibold capitalize">{h.action.replace(/_/g, " ")}</span> · {h.actorName ?? "system"} · {fmtDateTime(h.createdAt)}</p>
                      {h.note ? <p className="text-muted-foreground">{h.note}</p> : null}
                    </li>
                  ))}
                </ol>
              </div>

              {d.flag.resolutionNote ? (
                <p className="rounded-lg bg-muted p-3 text-sm"><span className="font-medium">Resolution:</span> {d.flag.resolutionNote}</p>
              ) : null}
            </div>

            {canManage ? (
              <div className="space-y-2 border-t pt-3">
                {["new", "acknowledged", "in_progress"].includes(d.flag.status) ? (
                  <>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the next action…" />
                    <div className="flex flex-wrap gap-2">
                      {d.flag.status === "new" ? (
                        <Button size="sm" variant="outline" disabled={actMut.isPending} onClick={() => actMut.mutate({ action: "acknowledge" })}>
                          <CheckCheck className="h-4 w-4" aria-hidden /> Acknowledge
                        </Button>
                      ) : null}
                      {d.flag.status !== "in_progress" ? (
                        <Button size="sm" variant="outline" disabled={actMut.isPending} onClick={() => actMut.mutate({ action: "progress" })}>
                          <CircleDot className="h-4 w-4" aria-hidden /> Start follow-up
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" disabled={actMut.isPending} onClick={() => actMut.mutate({ action: "assign-task" })}>
                        <UserRoundCheck className="h-4 w-4" aria-hidden /> Assign follow-up task
                      </Button>
                      <Button size="sm" disabled={actMut.isPending || !note.trim()} onClick={() => actMut.mutate({ action: "resolve", body: { note } })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="outline" className="text-danger" disabled={actMut.isPending || !note.trim()} onClick={() => actMut.mutate({ action: "dismiss", body: { reason: note } })}>
                        <Ban className="h-4 w-4" aria-hidden /> Dismiss
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Resolve and Dismiss require a note — both are logged to the audit trail with your name.</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">This flag is {d.flag.status.replace("_", " ")} — the record is kept for the audit trail.</p>
                )}
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── threshold config ─────────────────────────────────────────────────────────
const RULE_META: Record<string, { label: string; fields: { key: string; label: string; hint?: string }[] }> = {
  attendance_decline: {
    label: "Attendance decline",
    fields: [
      { key: "lookbackEvents", label: "Look-back services" },
      { key: "maxAttended", label: "Max attended to trigger" },
      { key: "priorMonths", label: "Prior months that count as 'was attending'" },
    ],
  },
  giving_decline: {
    label: "Giving decline",
    fields: [
      { key: "trailingDays", label: "Trailing window (days)" },
      { key: "baselineMonths", label: "Baseline months" },
      { key: "dropPct", label: "Drop % to trigger", hint: "Amounts stay hidden from viewers without giving visibility" },
      { key: "floorCents", label: "Baseline floor (kobo)", hint: "Ignore members below this baseline total" },
    ],
  },
  engagement_drop: {
    label: "Small-group engagement",
    fields: [{ key: "missStreak", label: "Missed meetings to trigger" }],
  },
};

function RulesDialog({ open, onClose, queryClient }: { open: boolean; onClose: () => void; queryClient: ReturnType<typeof useQueryClient> }) {
  const rulesQ = useQuery({ queryKey: ["risk", "rules"], queryFn: () => api.get<{ items: RuleRow[] }>("/risk/rules"), enabled: open });
  const [draft, setDraft] = useState<RuleRow[] | null>(null);
  const rows = draft ?? rulesQ.data?.items ?? [];

  const previewMut = useMutation({
    mutationFn: () => api.post<{ counts: Record<string, number>; peopleScanned: number }>("/risk/rules/preview", {
      rules: rows.map((r) => ({ signalType: r.signalType, enabled: r.enabled, thresholds: r.thresholds })),
    }),
    onError: (e) => toast.error(errMsg(e)),
  });
  const saveMut = useMutation({
    mutationFn: () => api.post<{ recalc: { created: number; escalated: number } }>("/risk/rules", {
      rules: rows.map((r) => ({ signalType: r.signalType, enabled: r.enabled, thresholds: r.thresholds })),
    }),
    onSuccess: (r) => {
      toast.success(`Thresholds saved — ${r.recalc.created} new flag(s), ${r.recalc.escalated} escalated`);
      queryClient.invalidateQueries({ queryKey: ["risk"] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  function setField(signalType: string, key: string, value: number) {
    setDraft(rows.map((r) => (r.signalType === signalType ? { ...r, thresholds: { ...r.thresholds, [key]: value } } : r)));
  }
  function setEnabled(signalType: string, enabled: boolean) {
    setDraft(rows.map((r) => (r.signalType === signalType ? { ...r, enabled } : r)));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Care Radar thresholds</DialogTitle>
          <DialogDescription>Deterministic, per-church rules. Preview the impact before saving — the recalculation runs immediately after.</DialogDescription>
        </DialogHeader>
        {rulesQ.isLoading ? <LoadingBlock label="Loading rules…" /> : (
          <div className="scroll-slim max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{RULE_META[r.signalType]?.label ?? r.signalType}</p>
                  <Switch checked={r.enabled} onCheckedChange={(v) => setEnabled(r.signalType, v)} aria-label={`Enable ${r.signalType}`} />
                </div>
                <Separator className="my-2" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {(RULE_META[r.signalType]?.fields ?? []).map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`${r.signalType}-${f.key}`} className="text-xs">{f.label}</Label>
                      <Input id={`${r.signalType}-${f.key}`} type="number" min={0} value={r.thresholds[f.key] ?? 0}
                        onChange={(e) => setField(r.signalType, f.key, Number(e.target.value))} className="h-8" />
                      {f.hint ? <p className="text-[10px] text-muted-foreground">{f.hint}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {previewMut.data ? (
              <div className="rounded-lg bg-info-bg p-3 text-sm text-ink-secondary">
                <p className="flex items-center gap-1.5 font-medium text-ink"><TrendingDown className="h-4 w-4" aria-hidden /> Preview impact ({previewMut.data.peopleScanned} people scanned)</p>
                <p className="mt-1">
                  watch: <strong>{previewMut.data.counts.watch}</strong> · elevated: <strong>{previewMut.data.counts.elevated}</strong> · urgent: <strong>{previewMut.data.counts.urgent}</strong>
                </p>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
            {previewMut.isPending ? "Simulating…" : "Preview impact"}
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Saving…" : "Save & recalculate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
