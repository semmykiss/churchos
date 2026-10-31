"use client";

/**
 * Volunteers — coordinator's command center (Marcus).
 * Tabs: Plans (weekly scheduling) · Teams (roles + swap approvals) · Health & blockouts.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtTime, type PlanDTO, type PersonListItem, type Paged } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeftRight, Ban, CalendarDays, MoreHorizontal, Plus, ShieldAlert, Trash2, UserPlus, Users,
} from "lucide-react";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, Section, StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ── local shapes ─────────────────────────────────────────────────────────────
interface RoleDTO {
  id: string; name: string; team: string | null; description: string | null;
  requiresBackgroundCheck: boolean; minAge: number | null; clearanceRequired: string | null; isActive: boolean;
}
interface PlanPosition {
  roleId: string; roleName: string; person: { id: string; name: string } | null;
  status: string; callTime?: string | null; assignmentId?: string; id?: string;
}
interface PlanWithEvent extends PlanDTO { positions: PlanPosition[]; }
interface SwapDTO {
  id: string;
  assignment: { id: string; roleName: string; startsAt: string; person: { id: string; name: string } };
  requestedWith: { id?: string; name: string };
  status: string;
}
interface BlockoutDTO { id: string; personId: string; name: string; startsOn: string; endsOn: string; reason: string | null; }
interface HealthDTO { personId: string; name: string; servedLast90: number; declined: number; noShows: number; reliability: number; }

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.";
}
/** callTime arrives as "HH:mm" (not ISO) — format 12h without Date parsing. */
function fmtCallTime(t?: string | null): string {
  if (!t) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? t : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}
function normPct(v: number): number {
  if (v > 0 && v <= 1) return Math.round(v * 100);
  return Math.round(v);
}
type Tone = "positive" | "warning" | "negative";
function pctTone(v: number): Tone {
  return v >= 90 ? "positive" : v >= 60 ? "warning" : "negative";
}
function ProgressTone({ value, tone }: { value: number; tone: Tone }) {
  return (
    <Progress
      value={Math.max(0, Math.min(100, value))}
      aria-label={`${Math.round(value)}%`}
      className={cn(
        tone === "positive" && "[&_[data-slot=progress-indicator]]:bg-teal-600",
        tone === "warning" && "[&_[data-slot=progress-indicator]]:bg-amber-500",
        tone === "negative" && "[&_[data-slot=progress-indicator]]:bg-red-500",
      )}
    />
  );
}

/** Search + pick a person (GET people?search=). */
function PersonPicker({ onPick, autoFocus }: { onPick: (p: { id: string; name: string }) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useApiQuery<Paged<PersonListItem>>(
    ["people", "search", q],
    `/people${qs({ search: q, pageSize: 8 })}`,
    { placeholderData: (prev) => prev },
  );
  return (
    <div className="space-y-2">
      <div className="relative">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name or email…" autoFocus={autoFocus} aria-label="Search people" />
      </div>
      <div className="max-h-56 overflow-y-auto scroll-slim rounded-md border" role="listbox" aria-label="Search results">
        {isLoading ? (
          <p className="p-3 text-xs text-muted-foreground">Searching…</p>
        ) : !data?.items.length ? (
          <p className="p-3 text-xs text-muted-foreground">No people matched “{q || "…"}”.</p>
        ) : (
          data.items.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
              className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent rounded-md"
              onClick={() => onPick({ id: p.id, name: `${p.firstName} ${p.lastName}` })}
            >
              <PersonAvatar name={`${p.firstName} ${p.lastName}`} className="h-7 w-7 text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.firstName} {p.lastName}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.email || p.phone || "No contact info"}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── module ───────────────────────────────────────────────────────────────────
import { RotaAiPanel } from "@/components/app/volunteers/rota-ai";

export default function VolunteersModule({ user }: ModuleProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Volunteers"
        description="Build Sunday plans, keep teams stocked, and watch volunteer health."
      />
      <Tabs defaultValue="plans">
        <TabsList className="flex w-full max-w-md">
          <TabsTrigger value="plans" className="flex-1">Plans</TabsTrigger>
          <TabsTrigger value="teams" className="flex-1">Teams</TabsTrigger>
          <TabsTrigger value="health" className="flex-1">Health &amp; blockouts</TabsTrigger>
          <TabsTrigger value="rotaai" className="flex-1">Rota AI</TabsTrigger>
        </TabsList>
        <TabsContent value="plans"><PlansTab /></TabsContent>
        <TabsContent value="teams"><TeamsTab user={user} /></TabsContent>
        <TabsContent value="health"><HealthTab /></TabsContent>
        <TabsContent value="rotaai"><RotaAiPanel user={user} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Plans tab ────────────────────────────────────────────────────────────────
function nextSundays(): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  for (let i = 0; i < 4; i++) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function PlansTab() {
  const queryClient = useQueryClient();
  const sundays = useMemo(() => nextSundays(), []);
  const [weekIdx, setWeekIdx] = useState(0);

  const from = sundays[weekIdx];
  const to = useMemo(() => new Date(from.getTime() + 6 * 86400000), [from]);
  const plansQ = useApiQuery<{ items: PlanWithEvent[] }>(
    ["volunteers", "plans", toYMD(from)],
    `/plans${qs({ from: toYMD(from), to: toYMD(to) })}`,
  );

  // assign dialog state
  const [assignFor, setAssignFor] = useState<{ eventId: string; roleId: string; roleName: string } | null>(null);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [callTime, setCallTime] = useState("");

  const assignMut = useMutation({
    mutationFn: (input: { roleId: string; personId: string; eventId: string; callTime?: string }) =>
      api.post("/assignments", input),
    onSuccess: () => {
      toast.success("Volunteer assigned — they've been asked to respond.");
      setAssignFor(null);
      setPicked(null);
      setCallTime("");
      queryClient.invalidateQueries({ queryKey: ["volunteers", "plans"] });
      queryClient.invalidateQueries({ queryKey: ["volunteers", "health"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const actMut = useMutation({
    mutationFn: ({ kind, id }: { kind: "no-show" | "remove"; id: string }) =>
      kind === "no-show" ? api.post(`/assignments/${id}/no-show`) : api.del(`/assignments/${id}`),
    onSuccess: (_res, vars) => {
      toast.success(vars.kind === "no-show" ? "Marked as no-show." : "Assignment removed.");
      queryClient.invalidateQueries({ queryKey: ["volunteers", "plans"] });
      queryClient.invalidateQueries({ queryKey: ["volunteers", "health"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const [swapFor, setSwapFor] = useState<{ id: string; roleName: string } | null>(null);
  const swapMut = useMutation({
    mutationFn: ({ id, withPersonId }: { id: string; withPersonId: string }) =>
      api.post(`/assignments/${id}/swap`, { withPersonId }),
    onSuccess: () => {
      toast.success("Swap requested — waiting for leader approval.");
      setSwapFor(null);
      queryClient.invalidateQueries({ queryKey: ["volunteers", "swaps"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const plans = plansQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Select value={String(weekIdx)} onValueChange={(v) => setWeekIdx(Number(v))}>
            <SelectTrigger className="w-64" aria-label="Plan week">
              <SelectValue placeholder="Pick a week" />
            </SelectTrigger>
            <SelectContent>
              {sundays.map((d, i) => (
                <SelectItem key={i} value={String(i)}>
                  Week of {fmtDate(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {plansQ.isLoading ? <LoadingBlock label="Loading plans…" />
        : plansQ.error ? <ErrorBlock error={plansQ.error} />
        : !plans.length ? (
          <EmptyState icon={CalendarDays} title="No services scheduled this week" description="Create an event with volunteer positions to see a plan here." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {plans.map((plan) => {
              const pct = normPct(plan.fillRate);
              const tone = pctTone(pct);
              return (
                <Card key={plan.eventId}>
                  <CardHeader className="flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base">{plan.eventName ?? "Service"}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(plan.startsAt)} · {fmtTime(plan.startsAt)}
                      </p>
                    </div>
                    {plan.needsAttention ? (
                      <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Reminders due
                      </Badge>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <ProgressTone value={pct} tone={tone} />
                      <span className={cn(
                        "w-12 shrink-0 text-right text-sm font-semibold tabular-nums",
                        tone === "positive" && "text-teal-700 dark:text-teal-400",
                        tone === "warning" && "text-amber-700 dark:text-amber-400",
                        tone === "negative" && "text-red-700 dark:text-red-400",
                      )}>
                        {pct}%
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Role</TableHead>
                            <TableHead>Person</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Call</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plan.positions.map((pos, idx) => {
                            const aid = pos.assignmentId ?? pos.id ?? null;
                            return (
                              <TableRow key={`${pos.roleId}-${idx}`}>
                                <TableCell className="font-medium whitespace-nowrap">{pos.roleName}</TableCell>
                                <TableCell>
                                  {pos.person ? (
                                    <span className="flex items-center gap-2">
                                      <PersonAvatar name={pos.person.name} className="h-7 w-7 text-[10px]" />
                                      <span className="truncate">{pos.person.name}</span>
                                    </span>
                                  ) : (
                                    <span className="text-xs italic text-muted-foreground">— empty slot</span>
                                  )}
                                </TableCell>
                                <TableCell><StatusBadge status={pos.status} /></TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {fmtCallTime(pos.callTime)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {pos.person ? (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" aria-label={`Actions for ${pos.person.name} as ${pos.roleName}`}>
                                          <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => aid ? actMut.mutate({ kind: "no-show", id: aid }) : toast.error("Assignment id missing from plan feed.")}>
                                          <Ban /> Mark no-show
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => aid ? setSwapFor({ id: aid, roleName: pos.roleName }) : toast.error("Assignment id missing from plan feed.")}>
                                          <ArrowLeftRight /> Request swap
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="text-red-700 focus:text-red-700 dark:text-red-400" onClick={() => aid ? actMut.mutate({ kind: "remove", id: aid }) : toast.error("Assignment id missing from plan feed.")}>
                                          <Trash2 /> Remove
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => { setPicked(null); setAssignFor({ eventId: plan.eventId, roleId: pos.roleId, roleName: pos.roleName }); }}
                                    >
                                      <UserPlus /> Assign
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

      {/* Assign dialog */}
      <Dialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign — {assignFor?.roleName}</DialogTitle>
            <DialogDescription>Search for a volunteer and tap to assign. Blockout dates are checked by the server.</DialogDescription>
          </DialogHeader>
          <PersonPicker onPick={setPicked} autoFocus />
          {picked ? (
            <div className="flex items-center gap-2 rounded-md border bg-secondary/50 p-2">
              <PersonAvatar name={picked.name} className="h-7 w-7 text-[10px]" />
              <span className="text-sm font-medium">{picked.name}</span>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="assign-call-time">Call time (optional)</Label>
            <Input id="assign-call-time" type="time" value={callTime} onChange={(e) => setCallTime(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>Cancel</Button>
            <Button
              disabled={!picked || assignMut.isPending}
              onClick={() => picked && assignFor && assignMut.mutate({ roleId: assignFor.roleId, personId: picked.id, eventId: assignFor.eventId, callTime: callTime || undefined })}
            >
              {assignMut.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Swap dialog */}
      <SwapDialog target={swapFor} onClose={() => setSwapFor(null)} onSubmit={(withPersonId) => swapFor && swapMut.mutate({ id: swapFor.id, withPersonId })} pending={swapMut.isPending} />
    </div>
  );
}

function SwapDialog({ target, onClose, onSubmit, pending }: {
  target: { id: string; roleName: string } | null;
  onClose: () => void;
  onSubmit: (withPersonId: string) => void;
  pending: boolean;
}) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setPicked(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request swap — {target?.roleName}</DialogTitle>
          <DialogDescription>Pick who should take this spot. A leader approves the swap.</DialogDescription>
        </DialogHeader>
        <PersonPicker onPick={setPicked} autoFocus />
        {picked ? (
          <div className="flex items-center gap-2 rounded-md border bg-secondary/50 p-2">
            <PersonAvatar name={picked.name} className="h-7 w-7 text-[10px]" />
            <span className="text-sm font-medium">{picked.name}</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setPicked(null); onClose(); }}>Cancel</Button>
          <Button disabled={!picked || pending} onClick={() => picked && onSubmit(picked.id)}>
            {pending ? "Requesting…" : "Request swap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Teams tab ────────────────────────────────────────────────────────────────
function TeamsTab({ user }: ModuleProps) {
  const queryClient = useQueryClient();
  const rolesQ = useApiQuery<{ items: RoleDTO[] }>(["volunteers", "roles"], "/volunteer-roles");
  const swapsQ = useApiQuery<{ items: SwapDTO[] }>(["volunteers", "swaps"], "/swaps");

  const [roleOpen, setRoleOpen] = useState(false);
  const [form, setForm] = useState({ name: "", team: "", minAge: "", requiresBackgroundCheck: false, clearanceRequired: "" });

  const createRoleMut = useMutation({
    mutationFn: () =>
      api.post("/volunteer-roles", {
        name: form.name.trim(),
        team: form.team.trim() || undefined,
        minAge: form.minAge ? Number(form.minAge) : undefined,
        requiresBackgroundCheck: form.requiresBackgroundCheck,
        clearanceRequired: form.clearanceRequired.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Role created.");
      setRoleOpen(false);
      setForm({ name: "", team: "", minAge: "", requiresBackgroundCheck: false, clearanceRequired: "" });
      queryClient.invalidateQueries({ queryKey: ["volunteers", "roles"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const swapMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api.post(`/swaps/${id}/approve`, { action }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "approve" ? "Swap approved — roster updated." : "Swap rejected.");
      queryClient.invalidateQueries({ queryKey: ["volunteers", "swaps"] });
      queryClient.invalidateQueries({ queryKey: ["volunteers", "plans"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const roles = rolesQ.data?.items ?? [];
  const swaps = swapsQ.data?.items ?? [];
  const pendingSwaps = swaps.filter((s) => s.status === "requested");

  return (
    <div className="space-y-6">
      <Section
        title="Volunteer roles"
        description="Teams and requirements — background checks and clearance gates are enforced on assignment."
        actions={<Button size="sm" onClick={() => setRoleOpen(true)}><Plus /> New role</Button>}
      >
        {rolesQ.isLoading ? <LoadingBlock /> : rolesQ.error ? <ErrorBlock error={rolesQ.error} /> : !roles.length ? (
          <EmptyState icon={Users} title="No roles yet" description="Create your first role — greeter, nursery, slides…" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((r) => (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="truncate">{r.name}</span>
                    {r.team ? <Badge variant="secondary" className="shrink-0">{r.team}</Badge> : null}
                  </CardTitle>
                  {!r.isActive ? <Badge variant="outline" className="mt-1 w-fit text-muted-foreground">Inactive</Badge> : null}
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  {r.description ? <p className="line-clamp-2">{r.description}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.requiresBackgroundCheck ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Background check
                      </span>
                    ) : null}
                    {r.minAge != null ? <Badge variant="outline">Min age {r.minAge}</Badge> : null}
                    {r.clearanceRequired ? <Badge variant="outline">Clearance: {r.clearanceRequired}</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Swap requests" description="Approving a swap moves the person onto the assignment and re-validates clearance.">
        {swapsQ.isLoading ? <LoadingBlock /> : swapsQ.error ? <ErrorBlock error={swapsQ.error} /> : !swaps.length ? (
          <EmptyState icon={ArrowLeftRight} title="No swap requests" description="When a volunteer requests a swap it lands here for approval." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Current → requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {swaps.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium whitespace-nowrap">{s.assignment.roleName}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(s.assignment.startsAt)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        {s.assignment.person?.name ?? "—"}
                        <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        {s.requestedWith?.name ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="text-right">
                      {s.status === "requested" && user.permissions.includes("schedule.assign") ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" disabled={swapMut.isPending} onClick={() => swapMut.mutate({ id: s.id, action: "approve" })}>Approve</Button>
                          <Button size="sm" variant="outline" disabled={swapMut.isPending} onClick={() => swapMut.mutate({ id: s.id, action: "reject" })}>Reject</Button>
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {pendingSwaps.length ? (
          <p className="text-xs text-muted-foreground">{pendingSwaps.length} pending swap{pendingSwaps.length === 1 ? "" : "s"} awaiting approval.</p>
        ) : null}
      </Section>

      {/* New role dialog */}
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New volunteer role</DialogTitle>
            <DialogDescription>Roles define who can be scheduled and what clearance is required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name *</Label>
              <Input id="role-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Greeter" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-team">Team</Label>
              <Input id="role-team" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="e.g. Host team" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="role-minage">Min age</Label>
                <Input id="role-minage" type="number" min={0} value={form.minAge} onChange={(e) => setForm({ ...form, minAge: e.target.value })} placeholder="18" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-clearance">Clearance required</Label>
                <Input id="role-clearance" value={form.clearanceRequired} onChange={(e) => setForm({ ...form, clearanceRequired: e.target.value })} placeholder="e.g. safeguarding" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="role-bgc" className="text-sm font-medium">Background check required</Label>
                <p className="text-xs text-muted-foreground">Volunteers must clear a background check first.</p>
              </div>
              <Switch id="role-bgc" checked={form.requiresBackgroundCheck} onCheckedChange={(v) => setForm({ ...form, requiresBackgroundCheck: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleOpen(false)}>Cancel</Button>
            <Button disabled={!form.name.trim() || createRoleMut.isPending} onClick={() => createRoleMut.mutate()}>
              {createRoleMut.isPending ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Health & blockouts tab ───────────────────────────────────────────────────
function HealthTab() {
  const queryClient = useQueryClient();
  const healthQ = useApiQuery<{ items: HealthDTO[] }>(["volunteers", "health"], "/volunteer-health");
  const blockoutsQ = useApiQuery<{ items: BlockoutDTO[] }>(["volunteers", "blockouts"], "/blockouts");

  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");

  const blockMut = useMutation({
    mutationFn: () => api.post("/blockouts", { personId: picked?.id, startsOn, endsOn, reason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.success("Blockout saved — scheduling will avoid these dates.");
      setOpen(false);
      setPicked(null); setStartsOn(""); setEndsOn(""); setReason("");
      queryClient.invalidateQueries({ queryKey: ["volunteers", "blockouts"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const health = healthQ.data?.items ?? [];
  const blockouts = blockoutsQ.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Section title="Volunteer health" description="Serving pattern over the last 90 days — reliability = served ÷ (served + no-shows).">
        {healthQ.isLoading ? <LoadingBlock /> : healthQ.error ? <ErrorBlock error={healthQ.error} /> : !health.length ? (
          <EmptyState icon={Users} title="No serving history yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Volunteer</TableHead>
                  <TableHead className="text-right">Served 90d</TableHead>
                  <TableHead className="text-right">Declined</TableHead>
                  <TableHead className="text-right">No-shows</TableHead>
                  <TableHead>Reliability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.map((h) => {
                  const rel = normPct(h.reliability);
                  const tone = pctTone(rel);
                  return (
                    <TableRow key={h.personId}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <PersonAvatar name={h.name} className="h-7 w-7 text-[10px]" />
                          <span className="font-medium">{h.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{h.servedLast90}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.declined}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", h.noShows > 0 && "font-semibold text-red-700 dark:text-red-400")}>{h.noShows}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <ProgressTone value={rel} tone={tone} />
                          <span className="w-10 text-right text-xs tabular-nums">{rel}%</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section
        title="Blockout dates"
        description="Dates a volunteer cannot serve. Assignments during a blockout are rejected."
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Add blockout</Button>}
      >
        {blockoutsQ.isLoading ? <LoadingBlock /> : blockoutsQ.error ? <ErrorBlock error={blockoutsQ.error} /> : !blockouts.length ? (
          <EmptyState icon={CalendarDays} title="No blockouts" description="Volunteers and coordinators can add unavailable dates here." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {blockouts.map((b) => (
              <li key={b.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(b.startsOn)} → {fmtDate(b.endsOn)}</p>
                {b.reason ? <p className="mt-1 text-xs italic text-muted-foreground">“{b.reason}”</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Add blockout dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add blockout</DialogTitle>
            <DialogDescription>Blockouts are honored when assigning volunteers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Volunteer</Label>
              <PersonPicker onPick={setPicked} />
              {picked ? (
                <div className="flex items-center gap-2 rounded-md border bg-secondary/50 p-2">
                  <PersonAvatar name={picked.name} className="h-7 w-7 text-[10px]" />
                  <span className="text-sm font-medium">{picked.name}</span>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="blockout-from">From</Label>
                <Input id="blockout-from" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blockout-to">To</Label>
                <Input id="blockout-to" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blockout-reason">Reason (optional)</Label>
              <Textarea id="blockout-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation, work travel…" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!picked || !startsOn || !endsOn || blockMut.isPending} onClick={() => blockMut.mutate()}>
              {blockMut.isPending ? "Saving…" : "Save blockout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
