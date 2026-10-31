"use client";

/**
 * Rota AI (Feature 3) — deterministic auto-fill for the existing volunteer
 * scheduling module. Preview is a pure dry-run; committing creates real
 * "asked" assignments through the existing assign path (tokens, notifications,
 * audit unchanged). Unfilled slots show per-person exclusion reasons; the
 * burnout table flags anyone at/over their monthly limit.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { fmtDateShort } from "@/lib/types";
import { toast } from "sonner";
import { EmptyState, LoadingBlock, ErrorBlock, Section } from "@/components/app/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Wand2, AlertTriangle, CheckCircle2, Gauge, Send, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

interface SlotResult {
  roleId: string; roleName: string; team?: string | null;
  status: "filled" | "unfilled";
  chosen?: { personId: string; name: string; daysSinceLastServed: number | null; servesLast90: number; servesThisMonth: number; maxTimesPerMonth: number };
  exclusions: { personId: string; name: string; reason: string }[];
  eligibleCount: number;
}
interface PreviewEvent { eventId: string; eventName: string; startsAt: string; slots: SlotResult[]; filledCount: number; totalCount: number }
interface PreviewResp { events: PreviewEvent[]; rolesTotal: number; rolesFilled: number }
interface BurnoutResp { month: string; items: { person: { id: string; name: string }; servesThisMonth: number; maxTimesPerMonth: number; servesLast90: number; lastServedAt: string | null; level: string }[] }

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RotaAiPanel({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState(() => {
    const from = new Date();
    const to = new Date(Date.now() + 28 * 86400000);
    return { from: ymdLocal(from), to: ymdLocal(to) };
  });
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // `${eventId}:${roleId}:${personId}`
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewMut = useMutation({
    mutationFn: () => api.post<PreviewResp>("/serving/rota/preview", { from: range.from, to: range.to }),
    onSuccess: (r) => { setPreview(r); setExcluded(new Set()); toast.success(`Draft ready — ${r.rolesFilled}/${r.rolesTotal} open roles fillable`); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const commitMut = useMutation({
    mutationFn: () => {
      const assignments: { eventId: string; roleId: string; personId: string }[] = [];
      for (const ev of preview?.events ?? []) {
        for (const slot of ev.slots) {
          if (slot.status === "filled" && slot.chosen && !excluded.has(`${ev.eventId}:${slot.roleId}:${slot.chosen.personId}`)) {
            assignments.push({ eventId: ev.eventId, roleId: slot.roleId, personId: slot.chosen.personId });
          }
        }
      }
      return api.post<{ created: number; errors: { message: string }[] }>("/serving/rota/commit", { assignments });
    },
    onSuccess: (r) => {
      toast.success(`${r.created} assignment(s) sent — volunteers are asked via their normal response flow${r.errors.length ? ` · ${r.errors.length} failed` : ""}`);
      setConfirmOpen(false);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["volunteers", "plans"] });
      queryClient.invalidateQueries({ queryKey: ["volunteers"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const burnoutQ = useQuery({ queryKey: ["serving", "burnout"], queryFn: () => api.get<BurnoutResp>("/serving/burnout") });

  const canManage = user.permissions.includes("schedule.assign") || user.permissions.includes("serving.schedule.manage") || user.permissions.includes("*");
  const totalFillable = preview?.events.reduce((a, e) => a + e.slots.filter((s) => s.status === "filled").length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">From</p>
              <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="h-9 rounded-md border border-input bg-surface-sunken px-3 text-sm" aria-label="Rota range start" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">To</p>
              <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="h-9 rounded-md border border-input bg-surface-sunken px-3 text-sm" aria-label="Rota range end" />
            </div>
            <Button onClick={() => previewMut.mutate()} disabled={!canManage || previewMut.isPending}>
              <Wand2 className="h-4 w-4" aria-hidden /> {previewMut.isPending ? "Solving constraints…" : "Auto-fill draft"}
            </Button>
            {preview ? (
              <>
                <Button variant="outline" onClick={() => { setPreview(null); setExcluded(new Set()); }}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Discard draft
                </Button>
                <Button disabled={!canManage || commitMut.isPending || totalFillable === 0} onClick={() => setConfirmOpen(true)}>
                  <Send className="h-4 w-4" aria-hidden /> Review &amp; send ({totalFillable})
                </Button>
              </>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            The engine honors blockouts, rest windows, monthly limits and role enrollment — deterministically, same inputs → same rota.
            Nothing is sent until you review the draft and click send.
          </p>
        </CardContent>
      </Card>

      {previewMut.isError ? <ErrorBlock error={previewMut.error} /> : null}

      {preview ? (
        <div className="space-y-4">
          {preview.events.map((ev) => (
            <Card key={ev.eventId}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <p className="font-semibold">{ev.eventName}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateShort(ev.startsAt)}</p>
                  </div>
                  <Badge variant="outline" className={ev.filledCount === ev.totalCount && ev.totalCount > 0 ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}>
                    {ev.filledCount}/{ev.totalCount} roles
                  </Badge>
                </div>
                <div className="divide-y">
                  {ev.slots.map((slot) => (
                    <div key={slot.roleId} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{slot.roleName}</p>
                        {slot.team ? <span className="text-[11px] text-muted-foreground">{slot.team}</span> : null}
                        {slot.status === "filled" && slot.chosen ? (
                          <span className="ml-auto flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                            <span className="font-medium">{slot.chosen.name}</span>
                            <span className="text-xs text-muted-foreground">
                              last served {slot.chosen.daysSinceLastServed === null ? "never" : `${slot.chosen.daysSinceLastServed}d ago`} · {slot.chosen.servesLast90}×/90d
                            </span>
                            <Checkbox
                              checked={!excluded.has(`${ev.eventId}:${slot.roleId}:${slot.chosen.personId}`)}
                              onCheckedChange={(v) => {
                                const key = `${ev.eventId}:${slot.roleId}:${slot.chosen!.personId}`;
                                setExcluded((prev) => { const n = new Set(prev); if (v === true) n.delete(key); else n.add(key); return n; });
                              }}
                              aria-label={`Include ${slot.chosen.name} for ${slot.roleName}`}
                            />
                          </span>
                        ) : (
                          <Badge variant="outline" className="ml-auto bg-danger-bg text-danger">
                            <AlertTriangle className="mr-1 h-3 w-3" aria-hidden /> Unfilled — {slot.eligibleCount === 0 ? "no eligible volunteer" : "all excluded"}
                          </Badge>
                        )}
                      </div>
                      {slot.exclusions.length ? (
                        <ul className="mt-1.5 space-y-0.5 pl-4">
                          {slot.exclusions.slice(0, 4).map((x, i) => (
                            <li key={i} className="text-[11px] text-muted-foreground">{x.name}: {x.reason}</li>
                          ))}
                          {slot.exclusions.length > 4 ? <li className="text-[11px] text-muted-foreground">+{slot.exclusions.length - 4} more</li> : null}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                  {!ev.slots.length ? <p className="px-4 py-3 text-sm text-muted-foreground">All roles already staffed for this date.</p> : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !previewMut.isPending ? (
        <EmptyState icon={Wand2} title="No draft yet" description="Pick a date range and run the engine — you'll review every choice before anything is sent." />
      ) : null}

      <Section title="Burnout watch (this month)">
        {burnoutQ.isLoading ? <LoadingBlock label="Loading serving load…" />
          : burnoutQ.isError ? <ErrorBlock error={burnoutQ.error} />
          : !(burnoutQ.data?.items.length) ? <p className="text-sm text-muted-foreground">No roster volunteers configured yet — add people under their profile or the Teams tab.</p> : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {burnoutQ.data.items.slice(0, 12).map((v) => (
                <div key={v.person.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{v.person.name}</p>
                    <p className="text-[11px] text-muted-foreground">{v.servesLast90} serves in last 90 days{v.lastServedAt ? ` · last ${fmtDateShort(v.lastServedAt)}` : ""}</p>
                  </div>
                  <Badge variant="outline" className={cn(
                    "shrink-0",
                    v.level === "at_limit" ? "bg-danger-bg text-danger" : v.level === "warning" ? "bg-warning-bg text-warning" : v.level === "paused" ? "bg-muted text-muted-foreground" : "bg-success-bg text-success",
                  )}>
                    <Gauge className="mr-1 h-3 w-3" aria-hidden /> {v.servesThisMonth}/{v.maxTimesPerMonth}
                  </Badge>
                </div>
              ))}
            </div>
          )}
      </Section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send {totalFillable} assignment request(s)?</DialogTitle>
            <DialogDescription>
              Volunteers receive their normal ask flow (accept/decline). Unticked suggestions are skipped; unfilled roles stay flagged so you can recruit or relax constraints.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Back to draft</Button>
            <Button onClick={() => commitMut.mutate()} disabled={commitMut.isPending}>{commitMut.isPending ? "Sending…" : "Send requests"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
