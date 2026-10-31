"use client";

/**
 * My Serving Availability (Feature 3 self-service) — volunteers manage their
 * OWN roster constraints and blockouts without admin involvement (approvals
 * for swaps remain admin-gated as before). Server-enforced to the caller's
 * own person record; requires `serving.view.own`.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarOff, Plus, Trash2, PauseCircle, PlayCircle } from "lucide-react";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

interface MyConfig { status: string; roleIds: string[]; roleNames: string[]; maxTimesPerMonth: number; minDaysBetweenServes: number; note?: string | null }
interface MyServingResp {
  config: MyConfig | null;
  blockouts: { id: string; startsOn: string; endsOn: string; reason?: string | null }[];
  roles: { id: string; name: string; team?: string | null }[];
}

export function MyAvailabilityCard() {
  const queryClient = useQueryClient();
  const q = useQuery<MyServingResp, ApiError>({
    queryKey: ["serving", "me"],
    queryFn: () => api.get<MyServingResp>("/serving/my-overview"),
    retry: false,
  });

  // 403 = viewer lacks serving.view.own → render nothing (server is the gate).
  if (q.isError) return null;
  if (q.isLoading || !q.data) return null;

  return <AvailabilityBody data={q.data} queryClient={queryClient} />;
}

function AvailabilityBody({ data, queryClient }: { data: MyServingResp; queryClient: ReturnType<typeof useQueryClient> }) {
  const [maxTimes, setMaxTimes] = useState(data.config?.maxTimesPerMonth ?? 4);
  const [minDays, setMinDays] = useState(data.config?.minDaysBetweenServes ?? 6);
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set(data.config?.roleIds ?? []));
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const cfgMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.post("/serving/my-config", patch),
    onSuccess: () => { toast.success("Availability saved — the rota engine will respect it"); queryClient.invalidateQueries({ queryKey: ["serving", "me"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const blockMut = useMutation({
    mutationFn: () => api.post("/serving/my-blockouts", { startsOn: blockStart, endsOn: blockEnd, reason: blockReason || undefined }),
    onSuccess: () => { toast.success("Dates blocked out"); setBlockStart(""); setBlockEnd(""); setBlockReason(""); queryClient.invalidateQueries({ queryKey: ["serving", "me"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.del(`/serving/my-blockouts/${id}`),
    onSuccess: () => { toast.success("Blockout removed"); queryClient.invalidateQueries({ queryKey: ["serving", "me"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const paused = data.config?.status === "paused";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarOff className="h-4 w-4 text-muted-foreground" aria-hidden /> My serving availability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <Label htmlFor="my-max" className="text-xs">Max / month</Label>
            <Input id="my-max" type="number" min={0} max={31} value={maxTimes} onChange={(e) => setMaxTimes(Number(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="w-32">
            <Label htmlFor="my-rest" className="text-xs">Rest days between</Label>
            <Input id="my-rest" type="number" min={0} max={60} value={minDays} onChange={(e) => setMinDays(Number(e.target.value) || 0)} className="h-8" />
          </div>
          <Button size="sm" onClick={() => cfgMut.mutate({ maxTimesPerMonth: maxTimes, minDaysBetweenServes: minDays, roleIds: [...roleIds] })} disabled={cfgMut.isPending}>
            Save
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => cfgMut.mutate({ status: paused ? "active" : "paused" })}
            disabled={cfgMut.isPending}
          >
            {paused ? <PlayCircle className="h-4 w-4" aria-hidden /> : <PauseCircle className="h-4 w-4" aria-hidden />}
            {paused ? "Rejoin roster" : "Pause serving"}
          </Button>
          {paused ? <Badge variant="outline" className="bg-warning-bg text-warning">paused — you won&apos;t be auto-scheduled</Badge> : null}
        </div>

        {data.roles.length ? (
          <div>
            <Label className="text-xs">Roles I serve (leave all unticked = any role)</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {data.roles.map((r) => {
                const active = roleIds.has(r.id);
                return (
                  <button key={r.id} type="button"
                    onClick={() => setRoleIds((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                    className={active ? "rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground" : "rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"}>
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dates I&apos;m away</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="bl-start" className="text-xs">From</Label>
              <Input id="bl-start" type="date" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} className="h-8 w-36" />
            </div>
            <div>
              <Label htmlFor="bl-end" className="text-xs">To</Label>
              <Input id="bl-end" type="date" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} className="h-8 w-36" />
            </div>
            <Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Reason (optional)" className="h-8 w-44" />
            <Button size="sm" variant="outline" disabled={!blockStart || !blockEnd || blockMut.isPending} onClick={() => blockMut.mutate()}>
              <Plus className="h-4 w-4" aria-hidden /> Block out
            </Button>
          </div>
          {data.blockouts.length ? (
            <ul className="mt-2 space-y-1">
              {data.blockouts.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                  <span>{b.startsOn.slice(0, 10)} → {b.endsOn.slice(0, 10)}{b.reason ? <span className="ml-2 text-xs text-muted-foreground">{b.reason}</span> : null}</span>
                  <Button size="sm" variant="ghost" aria-label="Remove blockout" onClick={() => delMut.mutate(b.id)} disabled={delMut.isPending}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
