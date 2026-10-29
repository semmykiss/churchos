"use client";

/**
 * Pastoral care — confidentiality is the feature.
 * Tabs: Cases · Prayer requests. Pastors-tier notes are only readable by owners
 * (the server enforces it and the UI says so instead of pretending).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDate, fmtDateTime, type CareCaseDTO, type PersonListItem, type Paged } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle, Check, ChevronRight, Lock, Plus, ShieldAlert, Users, X,
} from "lucide-react";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, Section, StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// ── local shapes ─────────────────────────────────────────────────────────────
interface CareNoteDTO { id: string; authorName: string; kind: string; body: string; visibility: string; occurredAt: string; }
interface CaseDetail {
  case: CareCaseDTO & { safeguardingBanner?: string };
  notes: CareNoteDTO[];
  notesVisible: boolean;
  timeline: { at: string; kind: string; authorName: string; summary: string }[];
}
interface PrayerDTO {
  id: string;
  person: { id: string; name: string } | null;
  audience: string;
  status: string;
  isAnonymous: boolean;
  expiresAt: string | null;
  createdAt: string;
  body: string;
}

const CASE_TYPES = [
  { value: "hospital", label: "Hospital visit" },
  { value: "bereavement", label: "Bereavement" },
  { value: "counseling", label: "Counseling" },
  { value: "food_assistance", label: "Food assistance" },
  { value: "safeguarding", label: "Safeguarding" },
  { value: "new_believer", label: "New believer" },
  { value: "follow_up", label: "Follow-up" },
  { value: "other", label: "Other" },
] as const;
const URGENCIES = ["low", "normal", "high", "urgent"] as const;
const TIERS = [
  { value: "staff", label: "Staff" },
  { value: "case_team", label: "Case team" },
  { value: "pastors", label: "Pastors only" },
] as const;
const AUDIENCES = [
  { value: "private", label: "Private" },
  { value: "group", label: "Group" },
  { value: "staff", label: "Staff" },
  { value: "church", label: "Church-wide" },
] as const;

const TYPE_LABELS: Record<string, string> = Object.fromEntries(CASE_TYPES.map((t) => [t.value, t.label]));

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.";
}

/** Search + pick a person (GET people?search=). */
function PersonPicker({ onPick, picked, autoFocus }: {
  onPick: (p: { id: string; name: string }) => void;
  picked: { id: string; name: string } | null;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useApiQuery<Paged<PersonListItem>>(
    ["people", "search", q],
    `/people${qs({ search: q, pageSize: 8 })}`,
    { placeholderData: (prev) => prev },
  );
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name or email…" autoFocus={autoFocus} aria-label="Search people" />
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
              {picked?.id === p.id ? <Check className="h-4 w-4 text-teal-700" /> : null}
            </button>
          ))}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === "pastors") {
    return (
      <Badge variant="outline" className="gap-1 border-transparent bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200">
        <Lock className="h-3 w-3" aria-hidden /> Pastors only
      </Badge>
    );
  }
  return <Badge variant="outline" className="capitalize">{tier.replace("_", " ")}</Badge>;
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const tone =
    urgency === "urgent" ? "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
    : urgency === "high" ? "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    : "border-transparent bg-muted text-muted-foreground";
  return <Badge variant="outline" className={cn("capitalize", tone)}>{urgency}</Badge>;
}

// ── module ───────────────────────────────────────────────────────────────────
export default function CareModule({ user }: ModuleProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pastoral care"
        description="Confidential care cases and prayer requests. Access is tiered and every read is audited."
      />
      <TabsNav user={user} />
    </div>
  );
}

function TabsNav({ user }: ModuleProps) {
  const [tab, setTab] = useState("cases");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Care sections" className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground">
        {[
          { v: "cases", label: "Cases" },
          { v: "prayer", label: "Prayer requests" },
        ].map((t) => (
          <button
            key={t.v} type="button" role="tab" aria-selected={tab === t.v}
            onClick={() => setTab(t.v)}
            className={cn(
              "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow]",
              tab === t.v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "cases" ? <CasesTab user={user} /> : <PrayerTab user={user} />}
    </div>
  );
}

// ── Cases tab ────────────────────────────────────────────────────────────────
function chip(active: boolean) {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active ? "border-teal-700 bg-teal-700 text-white dark:bg-teal-600 dark:border-teal-600" : "bg-background text-muted-foreground hover:bg-accent",
  );
}

function CasesTab({ user }: ModuleProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | "open" | "closed">("open");
  const [urgency, setUrgency] = useState<"all" | (typeof URGENCIES)[number]>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const casesQ = useApiQuery<{ items: CareCaseDTO[] }>(
    ["care", "cases", status, urgency],
    `/care-cases${qs({ status: status === "all" ? undefined : status, urgency: urgency === "all" ? undefined : urgency })}`,
  );

  const cases = casesQ.data?.items ?? [];
  const canManage = user.permissions.includes("care.manage");
  const openCount = cases.filter((c) => c.status === "open").length;
  const urgentCount = cases.filter((c) => c.status === "open" && (c.urgency === "urgent" || c.urgency === "high")).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
          {(["all", "open", "closed"] as const).map((s) => (
            <button key={s} type="button" className={chip(status === s)} onClick={() => setStatus(s)} aria-pressed={status === s}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
          <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Urgency</span>
          <button type="button" className={chip(urgency === "all")} onClick={() => setUrgency("all")} aria-pressed={urgency === "all"}>All</button>
          {URGENCIES.map((u) => (
            <button key={u} type="button" className={chip(urgency === u)} onClick={() => setUrgency(u)} aria-pressed={urgency === u}>
              {u[0].toUpperCase() + u.slice(1)}
            </button>
          ))}
        </div>
        <Button onClick={() => setNewOpen(true)} size="sm"><Plus /> New case</Button>
      </div>

      {casesQ.isLoading ? <LoadingBlock label="Loading cases…" />
        : casesQ.error ? <ErrorBlock error={casesQ.error} />
        : !cases.length ? (
          <EmptyState icon={AlertTriangle} title="No care cases" description="Cases are confidential — you only see the tiers your role allows." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {cases.map((c) => {
              const overdue = c.status === "open" && c.dueDate && new Date(c.dueDate).getTime() < Date.now();
              return (
                <Card key={c.id} className={cn(c.isSafeguarding && "border-red-300 dark:border-red-900")}>
                  {c.isSafeguarding ? (
                    <div className="rounded-t-lg bg-red-100 px-4 py-2 text-xs font-medium text-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                        Safeguarding — mandatory reporting rules apply; record cannot be deleted.
                      </span>
                    </div>
                  ) : null}
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span className="flex min-w-0 items-center gap-2">
                        <PersonAvatar name={c.person.name} className="h-8 w-8 text-[10px]" />
                        <span className="min-w-0">
                          <span className="block truncate">{c.person.name}</span>
                          <span className="block text-xs font-normal text-muted-foreground">Opened {fmtDate(c.openedAt)}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        <UrgencyBadge urgency={c.urgency} />
                        <TierBadge tier={c.confidentialityTier} />
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{TYPE_LABELS[c.type] ?? c.type}</Badge>
                      <StatusBadge status={c.status} />
                      <Badge variant="outline" className="capitalize">{(c.stage ?? "new").replace("_", " ")}</Badge>
                      {c.noteCount ? <Badge variant="outline">{c.noteCount} note{c.noteCount === 1 ? "" : "s"}</Badge> : null}
                      {c.dueDate ? (
                        <span className={cn("text-xs", overdue ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                          Due {fmtDate(c.dueDate)}{overdue ? " · overdue" : ""}
                        </span>
                      ) : null}
                    </div>
                    {c.summary ? <p className="line-clamp-2 text-sm text-muted-foreground">{c.summary}</p> : null}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Owner: {c.ownerName ?? "—"}</span>
                      <Button variant="outline" size="sm" onClick={() => setDetailId(c.id)} aria-label={`Open case for ${c.person.name}`}>
                        Open <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

      <p className="text-xs text-muted-foreground">{openCount} open · {urgentCount} high/urgent · pastors-tier cases show a lock and are only readable by owners.</p>

      <NewCaseDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <CaseDetailDialog id={detailId} onClose={() => setDetailId(null)} canManage={canManage} />
    </div>
  );
}

function NewCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [type, setType] = useState<string>("follow_up");
  const [urgency, setUrgency] = useState<string>("normal");
  const [tier, setTier] = useState<string>("staff");
  const [summary, setSummary] = useState("");
  const [dueDate, setDueDate] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/care-cases", {
        personId: picked?.id,
        type,
        urgency,
        confidentialityTier: tier,
        summary: summary.trim() || undefined,
        dueDate: dueDate || undefined,
      }),
    onSuccess: () => {
      toast.success("Case opened — access is limited to the tier you chose.");
      onClose();
      setPicked(null); setType("follow_up"); setUrgency("normal"); setTier("staff"); setSummary(""); setDueDate("");
      queryClient.invalidateQueries({ queryKey: ["care", "cases"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New care case</DialogTitle>
          <DialogDescription>Every case is permanent — cases are closed, never deleted.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Person *</Label>
            <PersonPicker onPick={setPicked} picked={picked} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Case type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CASE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Urgency</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger aria-label="Urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {URGENCIES.map((u) => <SelectItem key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Confidentiality tier</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger aria-label="Confidentiality tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Who can read this? staff = office team · case_team = assigned team · pastors = pastors only</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-summary">Summary</Label>
            <Textarea id="case-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Context the assigned team should know…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-due">Due date</Label>
            <Input id="case-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Opening…" : "Open case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaseDetailDialog({ id, onClose, canManage }: { id: string | null; onClose: () => void; canManage: boolean }) {
  const queryClient = useQueryClient();
  const detailQ = useApiQuery<CaseDetail>(["care", "case", id ?? ""], `/care-cases/${id}`, { enabled: !!id });

  const [noteBody, setNoteBody] = useState("");
  const [noteKind, setNoteKind] = useState("note");
  const [noteVis, setNoteVis] = useState<string>("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");

  const c = detailQ.data?.case;
  const notes = detailQ.data?.notes ?? [];
  const notesVisible = detailQ.data?.notesVisible ?? true;
  const tier = c?.confidentialityTier ?? "staff";

  const noteMut = useMutation({
    mutationFn: () =>
      api.post(`/care-cases/${id}/notes`, { body: noteBody.trim(), kind: noteKind, visibility: noteVis || tier }),
    onSuccess: () => {
      toast.success("Note added.");
      setNoteBody("");
      queryClient.invalidateQueries({ queryKey: ["care", "case", id] });
      queryClient.invalidateQueries({ queryKey: ["care", "cases"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const closeMut = useMutation({
    mutationFn: () => api.post(`/care-cases/${id}/close`, { closeReason: closeReason.trim() }),
    onSuccess: () => {
      toast.success("Case closed. The record is retained — cases are never deleted.");
      setCloseOpen(false); setCloseReason("");
      queryClient.invalidateQueries({ queryKey: ["care", "case", id] });
      queryClient.invalidateQueries({ queryKey: ["care", "cases"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <>
      <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scroll-slim">
          {detailQ.isLoading || !c ? (
            <div className="py-8"><LoadingBlock label="Loading case…" /></div>
          ) : detailQ.error ? (
            <ErrorBlock error={detailQ.error} />
          ) : (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                  {c.person.name} — {TYPE_LABELS[c.type] ?? c.type}
                  <StatusBadge status={c.status} />
                </DialogTitle>
                <DialogDescription>
                  Owner {c.ownerName ?? "—"} · opened {fmtDate(c.openedAt)}
                  {c.dueDate ? ` · due ${fmtDate(c.dueDate)}` : ""}
                </DialogDescription>
              </DialogHeader>

              {c.isSafeguarding ? (
                <div className="rounded-md bg-red-100 px-3 py-2 text-xs font-medium text-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                    Safeguarding — mandatory reporting rules apply; record cannot be deleted.
                  </span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                <UrgencyBadge urgency={c.urgency} />
                <TierBadge tier={c.confidentialityTier} />
                <Badge variant="outline" className="capitalize">{(c.stage ?? "new").replace("_", " ")}</Badge>
              </div>

              {c.summary ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
                  {c.summary}
                </div>
              ) : null}

              {/* Notes */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Notes</h3>
                {!notesVisible ? (
                  <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground" role="note">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Notes restricted — pastors-tier notes are visible to owners only.
                  </div>
                ) : !notes.length ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  <ul className="max-h-60 space-y-2 overflow-y-auto scroll-slim pr-1">
                    {notes.map((n) => (
                      <li key={n.id} className="rounded-md border p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{n.authorName}</span>
                          <Badge variant="secondary" className="capitalize">{n.kind}</Badge>
                          <span>{fmtDateTime(n.occurredAt)}</span>
                          {n.visibility && n.visibility !== tier ? <Badge variant="outline" className="capitalize">{n.visibility}</Badge> : null}
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Timeline */}
              {notesVisible && detailQ.data?.timeline?.length ? (
                <div className="space-y-1 rounded-md border p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {detailQ.data.timeline.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-28 shrink-0 tabular-nums">{fmtDateTime(t.at)}</span>
                        <span><span className="font-medium text-foreground">{t.authorName}</span> · {t.kind} — {t.summary}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Add note */}
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Add note</p>
                <Textarea rows={2} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="What happened, what was said, next step…" aria-label="Note body" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Kind</Label>
                    <Select value={noteKind} onValueChange={setNoteKind}>
                      <SelectTrigger aria-label="Note kind"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="note">Note</SelectItem>
                        <SelectItem value="visit">Visit</SelectItem>
                        <SelectItem value="call">Call</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Visibility</Label>
                    <Select value={noteVis || tier} onValueChange={setNoteVis}>
                      <SelectTrigger aria-label="Note visibility"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button size="sm" disabled={!noteBody.trim() || noteMut.isPending} onClick={() => noteMut.mutate()}>
                  {noteMut.isPending ? "Saving…" : "Add note"}
                </Button>
              </div>

              {canManage && c.status === "open" ? (
                <div className="flex justify-end">
                  <Button variant="destructive" size="sm" onClick={() => setCloseOpen(true)}>Close case…</Button>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Close case confirm */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this case?</AlertDialogTitle>
            <AlertDialogDescription>
              A close reason is required. The record is retained permanently — care cases cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea rows={2} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Reason for closing…" aria-label="Close reason" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!closeReason.trim() || closeMut.isPending}
              onClick={(e) => { e.preventDefault(); closeMut.mutate(); }}
            >
              {closeMut.isPending ? "Closing…" : "Close case"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Prayer requests tab ──────────────────────────────────────────────────────
function AudienceBadge({ audience }: { audience: string }) {
  if (audience === "private") {
    return <Badge variant="outline" className="gap-1 border-transparent bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-100"><Lock className="h-3 w-3" aria-hidden /> Private</Badge>;
  }
  if (audience === "church") {
    return <Badge variant="outline" className="gap-1 border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200"><Users className="h-3 w-3" aria-hidden /> Church-wide</Badge>;
  }
  return <Badge variant="outline" className="capitalize">{audience}</Badge>;
}

function PrayerTab({ user }: ModuleProps) {
  const queryClient = useQueryClient();
  const reqQ = useApiQuery<{ items: PrayerDTO[] }>(["care", "prayer"], "/prayer-requests");
  const [newOpen, setNewOpen] = useState(false);

  const mut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api.post(`/prayer-requests/${id}/approve`, { action }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "approve" ? "Prayer request approved." : "Prayer request rejected.");
      queryClient.invalidateQueries({ queryKey: ["care", "prayer"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const items = reqQ.data?.items ?? [];
  const canManage = user.permissions.includes("care.manage");

  return (
    <div className="space-y-4">
      <Section
        title="Prayer requests"
        description="Audience-filtered. Pending requests need approval before they reach the wider church."
        actions={<Button size="sm" onClick={() => setNewOpen(true)}><Plus /> New request</Button>}
      >
        {reqQ.isLoading ? <LoadingBlock /> : reqQ.error ? <ErrorBlock error={reqQ.error} /> : !items.length ? (
          <EmptyState title="No prayer requests" description="Requests you or your team submit will appear here." />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {items.map((r) => (
              <li key={r.id} className="rounded-lg border p-4">
                <p className="text-sm">{r.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {r.person ? <PersonAvatar name={r.person.name} className="h-5 w-5 text-[9px]" /> : null}
                    {r.isAnonymous || !r.person ? "Anonymous" : r.person.name}
                  </span>
                  <AudienceBadge audience={r.audience} />
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-muted-foreground">· {fmtDate(r.createdAt)}{r.expiresAt ? ` · expires ${fmtDate(r.expiresAt)}` : ""}</span>
                  {canManage && r.status === "pending" ? (
                    <span className="ml-auto inline-flex gap-1.5">
                      <Button size="sm" variant="outline" aria-label="Reject request" disabled={mut.isPending} onClick={() => mut.mutate({ id: r.id, action: "reject" })}>
                        <X className="h-4 w-4" /> Reject
                      </Button>
                      <Button size="sm" aria-label="Approve request" disabled={mut.isPending} onClick={() => mut.mutate({ id: r.id, action: "approve" })}>
                        <Check className="h-4 w-4" /> Approve
                      </Button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <NewPrayerDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function NewPrayerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("staff");
  const [isAnonymous, setIsAnonymous] = useState(false);

  const mut = useMutation({
    mutationFn: () =>
      api.post("/prayer-requests", {
        personId: picked?.id,
        body: body.trim(),
        audience,
        isAnonymous,
      }),
    onSuccess: () => {
      toast.success("Prayer request submitted.");
      onClose();
      setPicked(null); setBody(""); setAudience("staff"); setIsAnonymous(false);
      queryClient.invalidateQueries({ queryKey: ["care", "prayer"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New prayer request</DialogTitle>
          <DialogDescription>Requests to the whole church are reviewed before publishing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Person (optional — defaults to you)</Label>
            <PersonPicker onPick={setPicked} picked={picked} />
            {picked ? (
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Clear selection (currently {picked.name})</Button>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prayer-body">Request *</Label>
            <Textarea id="prayer-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share as much as you're comfortable with…" />
          </div>
          <div className="space-y-1.5">
            <Label>Audience</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger aria-label="Audience"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="prayer-anon" className="text-sm font-medium">Submit anonymously</Label>
              <p className="text-xs text-muted-foreground">Your name is hidden from the request.</p>
            </div>
            <Switch id="prayer-anon" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!body.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
