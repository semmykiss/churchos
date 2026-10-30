"use client";

/**
 * Events module — per-occurrence services & gatherings.
 * List (desktop table / mobile cards), create, cancel, detail with attendance +
 * volunteer assignments, and a manual attendance editor for past services.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import {
  fmtDateTime,
  fmtTime,
  type EventDTO,
  type PersonListItem,
} from "@/lib/types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CalendarPlus,
  Clock,
  MapPin,
  Star,
  Users,
  Wrench,
  X,
} from "lucide-react";
/* ───────────────────────────── API shapes ───────────────────────────── */

interface EventDetailResp {
  event: EventDTO;
  attendance: {
    personId: string;
    name: string;
    status: string;
    checkedInAt: string | null;
    firstTime: boolean;
    isVolunteer: boolean;
    roomText?: string | null;
  }[];
  headcount: number;
  assignments: { personId: string; name: string; roleName: string; status: string }[];
}

interface ServicesResp {
  items: { id: string; name: string; timeOfDay: string; byDay: string; durationMinutes: number; checkinEnabled: boolean }[];
}

/* ───────────────────────────── helpers ───────────────────────────── */

const KIND_OPTIONS = [
  { value: "service", label: "Service" },
  { value: "group_meeting", label: "Group meeting" },
  { value: "class", label: "Class" },
  { value: "one_off", label: "One-off" },
];

const ATT_LABELS: Record<string, string> = {
  checked_in: "Checked in",
  checked_out: "Checked out",
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};

const ATT_TONES: Record<string, string> = {
  checked_in: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  present: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  late: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  absent: "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-400",
  excused: "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-400",
  checked_out: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-100",
};

function kindLabel(kind: string): string {
  return KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

function durationOf(e: EventDTO): string {
  const mins = Math.round((new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  return mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Local datetime → value usable in <input type="datetime-local"> */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const RANGES = {
  upcoming: () => ({ from: new Date().toISOString(), to: new Date(Date.now() + 30 * 864e5).toISOString() }),
  past30: () => ({ from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date().toISOString() }),
  next90: () => ({ from: new Date().toISOString(), to: new Date(Date.now() + 90 * 864e5).toISOString() }),
} as const;

type RangeKey = keyof typeof RANGES;

/* ───────────────────────────── module ───────────────────────────── */

export default function EventsModule({ user: _user }: ModuleProps) {
  const [range, setRange] = useState<RangeKey>("upcoming");
  const [kind, setKind] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { from, to } = RANGES[range]();
  const listQ = useApiQuery<{ items: EventDTO[] }>(
    ["events", "list", range, kind, search],
    `/events${qs({ from, to, kind: kind === "all" ? undefined : kind, search: search || undefined })}`
  );
  const events = listQ.data?.items ?? [];

  // this-week summary (independent of the selected filter range)
  const weekFrom = new Date().toISOString();
  const weekTo = new Date(Date.now() + 7 * 864e5).toISOString();
  const weekQ = useApiQuery<{ items: EventDTO[] }>(
    ["events", "week"],
    `/events${qs({ from: weekFrom, to: weekTo })}`
  );
  const weekEvents = weekQ.data?.items ?? [];
  const weekHeadcount = weekEvents.reduce((a, e) => a + (e.headcount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Services, group meetings and classes — with attendance, volunteers and manual headcounts."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <CalendarPlus className="h-4 w-4" /> New event
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="This week" value={weekEvents.length} sub="events in the next 7 days" icon={Users} />
        <StatCard label="Headcount this week" value={weekHeadcount} sub="across all events" icon={Users} tone="positive" />
        <StatCard
          label="Showing"
          value={events.length}
          sub={`${range === "past30" ? "past 30 days" : range === "next90" ? "next 90 days" : "upcoming"}${kind !== "all" ? ` · ${kindLabel(kind)}` : ""}`}
        />
        <StatCard label="With check-in" value={weekEvents.filter((e) => e.checkinEnabled).length} sub="kiosk enabled this week" />
      </div>

      <Section title="All events">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="sm:w-44" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past30">Past 30 days</SelectItem>
              <SelectItem value="next90">All next 90</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="sm:w-40" aria-label="Kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name…"
            className="sm:max-w-xs"
            aria-label="Search events"
          />
        </div>

        {listQ.isLoading ? (
          <LoadingBlock label="Loading events…" />
        ) : listQ.isError ? (
          <ErrorBlock error={listQ.error} />
        ) : events.length === 0 ? (
          <EmptyState
            title="No events found"
            description="Try a wider date range, or create the first event."
          />
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead className="text-right">Headcount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow
                      key={e.id}
                      className="row-hover cursor-pointer"
                      onClick={() => setDetailId(e.id)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{fmtDateTime(e.startsAt)}</span>
                        <span className="block text-xs text-muted-foreground">{durationOf(e)}</span>
                      </TableCell>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap">
                          {kindLabel(e.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{e.roomText || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.headcount ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* mobile cards */}
            <div className="space-y-3 md:hidden">
              {events.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setDetailId(e.id)}
                  className="w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{e.name}</p>
                    <StatusBadge status={e.status} />
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> {fmtDateTime(e.startsAt)} · {durationOf(e)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{kindLabel(e.kind)}</Badge>
                    {e.roomText ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden /> {e.roomText}
                      </span>
                    ) : null}
                    <span>Headcount {e.headcount ?? "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </Section>

      <EventDetailDialog id={detailId} onClose={() => setDetailId(null)} />
      <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/* ───────────────────────────── create ───────────────────────────── */

function CreateEventDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const servicesQ = useApiQuery<ServicesResp>(["services"], "/services");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("service");
  const [serviceId, setServiceId] = useState("none");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date(Date.now() + 7 * 864e5)));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 7 * 864e5 + 90 * 60000)));
  const [roomText, setRoomText] = useState("");
  const [capacity, setCapacity] = useState("");
  const [checkinEnabled, setCheckinEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post("/events", {
        name: name.trim(),
        kind,
        serviceId: serviceId === "none" ? undefined : serviceId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        roomText: roomText.trim() || undefined,
        capacity: capacity ? Math.round(Number(capacity)) : undefined,
        checkinEnabled,
      });
      toast.success("Event created.");
      onOpenChange(false);
      setName("");
      void qc.invalidateQueries({ queryKey: ["events"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the event."));
    } finally {
      setBusy(false);
    }
  }

  const valid = name.trim().length > 0 && startsAt && endsAt && new Date(endsAt) > new Date(startsAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>Events are per-occurrence — one row per date.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ev-name">Name</Label>
            <Input id="ev-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday Gathering" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="ev-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-service">Recurring service (optional)</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger id="ev-service">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(servicesQ.data?.items ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev-starts">Starts</Label>
              <Input id="ev-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-ends">Ends</Label>
              <Input id="ev-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev-room">Room</Label>
              <Input id="ev-room" value={roomText} onChange={(e) => setRoomText(e.target.value)} placeholder="Main Hall" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-capacity">Capacity</Label>
              <Input
                id="ev-capacity"
                type="number"
                min={0}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g. 200"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="ev-checkin">Kiosk check-in enabled</Label>
              <p className="text-xs text-muted-foreground">Allows opening a kiosk session from the Check-in module.</p>
            </div>
            <Switch id="ev-checkin" checked={checkinEnabled} onCheckedChange={setCheckinEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            Create event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── detail ───────────────────────────── */

function EventDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detailQ = useApiQuery<EventDetailResp>(["events", "detail", id], `/events/${id}`, {
    enabled: !!id,
  });

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-2xl">
        {detailQ.isLoading || !detailQ.data ? (
          <>
            <DialogHeader>
              <DialogTitle>Event details</DialogTitle>
            </DialogHeader>
            <LoadingBlock label="Loading event…" />
          </>
        ) : detailQ.isError ? (
          <>
            <DialogHeader>
              <DialogTitle>Event details</DialogTitle>
            </DialogHeader>
            <ErrorBlock error={detailQ.error} />
          </>
        ) : (
          <DetailBody resp={detailQ.data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({ resp }: { resp: EventDetailResp }) {
  const { event: e, attendance, headcount, assignments } = resp;
  const isPastOrToday = new Date(e.startsAt).getTime() <= endOfToday().getTime();
  const canManualAttend = e.kind === "service" && isPastOrToday && e.status !== "cancelled";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {e.name}
          <Badge variant="outline">{kindLabel(e.kind)}</Badge>
          <StatusBadge status={e.status} />
        </DialogTitle>
        <DialogDescription>
          {fmtDateTime(e.startsAt)} – {fmtTime(e.endsAt)}
          {durationOf(e) ? ` · ${durationOf(e)}` : ""}
          {e.roomText ? ` · ${e.roomText}` : ""}
          {e.capacity ? ` · capacity ${e.capacity}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Headcount" value={headcount} tone="positive" icon={Users} />
        <StatCard label="Attendance rows" value={attendance.length} sub="incl. volunteers" />
        <StatCard label="Volunteers assigned" value={assignments.length} icon={Wrench} />
      </div>

      <div className="flex justify-end">
        {e.status === "scheduled" ? <CancelEventButton eventId={e.id} eventName={e.name} /> : null}
      </div>

      <Section title="Attendance">
        {attendance.length === 0 ? (
          <EmptyState icon={Users} title="No attendance recorded" />
        ) : (
          <div className="max-h-80 overflow-y-auto scroll-slim rounded-lg border">
            <div className="divide-y">
              {attendance.map((a) => (
                <div key={a.personId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {a.name}
                      {a.firstTime ? (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-xs font-medium text-amber-700 dark:text-amber-400"
                          title="First time"
                        >
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-hidden /> First time
                        </span>
                      ) : null}
                      {a.isVolunteer ? (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-xs text-muted-foreground" title="Volunteer">
                          <Wrench className="h-3.5 w-3.5" aria-hidden /> Volunteer
                        </span>
                      ) : null}
                    </p>
                    {a.roomText ? <p className="text-xs text-muted-foreground">{a.roomText}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{a.checkedInAt ? fmtTime(a.checkedInAt) : ""}</span>
                    <Badge variant="outline" className={`border-transparent ${ATT_TONES[a.status] ?? ""}`}>
                      {ATT_LABELS[a.status] ?? a.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {assignments.length ? (
        <Section title="Volunteers">
          <div className="space-y-1.5">
            {assignments.map((a) => (
              <div key={a.personId + a.roleName} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <p className="text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground"> · {a.roleName}</span>
                </p>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {canManualAttend ? <ManualAttendance eventId={e.id} /> : null}
    </>
  );
}

function CancelEventButton({ eventId, eventName }: { eventId: string; eventName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/cancel`, { reason: reason.trim() || undefined });
      toast.success(`${eventName} cancelled.`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["events"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not cancel the event."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" className="gap-1.5 text-destructive" onClick={() => setOpen(true)}>
        Cancel event
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel “{eventName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This occurrence is marked cancelled and stays in history. Existing attendance is kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Weather closure"
            rows={2}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep event</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void cancel();
            }}
            disabled={busy}
          >
            Cancel event
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ───────────────────────────── manual attendance ───────────────────────────── */

interface ManualRecord {
  personId: string;
  name: string;
  status: string;
}

function ManualAttendance({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<ManualRecord[]>([]);
  const [reason, setReason] = useState("Manual entry from events screen");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const peopleQ = useApiQuery<{ items: PersonListItem[] }>(
    ["people-search", search],
    `/people${qs({ search, pageSize: 8 })}`,
    { enabled: search.trim().length >= 2 }
  );
  const candidates = (peopleQ.data?.items ?? []).filter((p) => !records.some((r) => r.personId === p.id));

  async function save() {
    setBusy(true);
    try {
      const resp = await api.post<{ saved: number }>(`/events/${eventId}/attendance`, {
        records: records.map((r) => ({ personId: r.personId, status: r.status })),
        method: "manual",
        reason: reason.trim() || "Manual attendance",
      });
      toast.success(`Saved ${resp.saved} attendance record${resp.saved === 1 ? "" : "s"} (corrected, audited).`);
      setRecords([]);
      setSearchInput("");
      void qc.invalidateQueries({ queryKey: ["events", "detail", eventId] });
      void qc.invalidateQueries({ queryKey: ["events"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not save attendance."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Manual attendance"
      description="Add people and mark present / absent / late / excused. Manual corrections are attributed and audited."
    >
      <div className="space-y-3 rounded-lg border p-3">
        <div className="space-y-1.5">
          <Label htmlFor="att-search">Find a person</Label>
          <Input
            id="att-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Type at least 2 characters…"
            autoComplete="off"
          />
          {search.trim().length >= 2 ? (
            <div className="max-h-40 overflow-y-auto scroll-slim rounded-md border">
              {peopleQ.isLoading ? (
                <LoadingBlock label="Searching…" />
              ) : candidates.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No matching people.</p>
              ) : (
                candidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => {
                      setRecords((prev) => [...prev, { personId: p.id, name: `${p.firstName} ${p.lastName}`, status: "present" }]);
                      setSearchInput("");
                    }}
                  >
                    <span>
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">{p.lifecycleStage.replace(/_/g, " ")}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody added yet.</p>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <div key={r.personId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <div className="flex items-center gap-2">
                  <Select
                    value={r.status}
                    onValueChange={(v) =>
                      setRecords((prev) => prev.map((x) => (x.personId === r.personId ? { ...x, status: v } : x)))
                    }
                  >
                    <SelectTrigger className="h-8 w-32" aria-label={`Status for ${r.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["present", "absent", "late", "excused"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {ATT_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => setRecords((prev) => prev.filter((x) => x.personId !== r.personId))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="att-reason">Reason (recorded on the audit log)</Label>
          <Input id="att-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={records.length === 0 || busy}>
            Save attendance ({records.length})
          </Button>
        </div>
      </div>
    </Section>
  );
}
