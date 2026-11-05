"use client";

/**
 * Events module — per-occurrence services & gatherings.
 * List (desktop table / mobile cards), create, cancel, detail with attendance +
 * volunteer assignments, and a manual attendance editor for past services.
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import {
  fmtDate,
  fmtDateTime,
  fmtTime,
  type EventDTO,
  type PersonListItem,
} from "@/lib/types";
import { EventDoorKiosk } from "@/components/app/events/kiosk";
import { QrScanDialog, QrTicketDialog } from "@/components/app/events/qr";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Banknote,
  CalendarPlus,
  Clock,
  Hourglass,
  ListChecks,
  MapPin,
  MonitorPlay,
  Plus,
  QrCode,
  ScanLine,
  Star,
  Ticket,
  Trash2,
  UserPlus,
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
  { value: "convention", label: "Convention" },
  { value: "retreat", label: "Retreat" },
];

const REG_LABELS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  waitlist: "Waitlisted",
  cancelled: "Cancelled",
};

const REG_TONES: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  confirmed: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  waitlist: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  cancelled: "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-400",
};

const PAY_METHOD_LABELS: Record<string, string> = {
  free: "Free",
  cash: "Cash",
  transfer: "Transfer",
  demo_card: "Card (demo)",
};

function fmtNaira(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `₦${(cents / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

function nairaToCents(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

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

export default function EventsModule({ user }: ModuleProps) {
  const canManage = user.permissions.includes("events.manage");
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

      <EventDetailDialog id={detailId} canManage={canManage} onClose={() => setDetailId(null)} />
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

function EventDetailDialog({ id, canManage, onClose }: { id: string | null; canManage: boolean; onClose: () => void }) {
  const detailQ = useApiQuery<EventDetailResp>(["events", "detail", id], `/events/${id}`, {
    enabled: !!id,
  });

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scroll-slim sm:max-w-3xl">
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
          <DetailBody resp={detailQ.data} canManage={canManage} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({ resp, canManage }: { resp: EventDetailResp; canManage: boolean }) {
  const { event: e, attendance, headcount, assignments } = resp;
  const isPastOrToday = new Date(e.startsAt).getTime() <= endOfToday().getTime();
  const canManualAttend = e.kind === "service" && isPastOrToday && e.status !== "cancelled";
  const [tab, setTab] = useState("overview");

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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
          <TabsTrigger value="registration" className="flex-1 gap-1.5">
            <Ticket className="h-3.5 w-3.5" aria-hidden /> Registration
          </TabsTrigger>
          <TabsTrigger value="program" className="flex-1 gap-1.5">
            <ListChecks className="h-3.5 w-3.5" aria-hidden /> Program
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-2 space-y-4">
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
        </TabsContent>

        <TabsContent value="registration" className="mt-2">
          <RegistrationPanel eventId={e.id} canManage={canManage} startsAt={e.startsAt} />
        </TabsContent>

        <TabsContent value="program" className="mt-2">
          <ProgramPanel eventId={e.id} eventStartsAt={e.startsAt} canManage={canManage} />
        </TabsContent>
      </Tabs>
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

/* ═══════════════════════ Registration & tickets ═══════════════════════ */

interface TicketTypeDTO {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  capacity: number | null;
  soldCount: number;
  maxPerOrder: number;
  salesEndAt: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface RegOverview {
  event: {
    id: string;
    name: string;
    kind: string;
    startsAt: string;
    endsAt: string;
    status: string;
    roomText: string | null;
    registrationEnabled: boolean;
    registrationCapacity: number | null;
    registrationDeadline: string | null;
    registrationNote: string | null;
  };
  ticketTypes: TicketTypeDTO[];
  stats: {
    heldSeats: number;
    remainingSeats: number | null;
    confirmedSeats: number;
    pendingSeats: number;
    pendingOrders: number;
    waitlistOrders: number;
    waitlistSeats: number;
    checkedInSeats: number;
    paidOrders: number;
    revenueCents: number;
  };
}

interface RegistrationDTO {
  id: string;
  eventId: string;
  ticketTypeId: string | null;
  ticketTypeName: string;
  quantity: number;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  paymentMethod: string | null;
  paymentRef: string | null;
  paidAt: string | null;
  personId: string | null;
  name: string;
  isGuest: boolean;
  guestEmail: string | null;
  guestPhone: string | null;
  qrToken?: string;
  checkedInAt: string | null;
  checkedInSeats: number;
  checkedInBy: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface ScanResult {
  name: string;
  eventName: string;
  ticketTypeName?: string;
  seatsTotal: number;
  seatsCheckedIn: number;
  alreadyDone: boolean;
  at: string;
}

function RegistrationPanel({ eventId, canManage, startsAt }: { eventId: string; canManage: boolean; startsAt: string }) {
  const overviewQ = useApiQuery<RegOverview>(["events", "registration", eventId], `/events/${eventId}/registration`);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const regsQ = useApiQuery<{ items: RegistrationDTO[] }>(
    ["events", "registrations", eventId, statusFilter, search],
    `/events/${eventId}/registrations${qs({ status: statusFilter, search: search || undefined })}`
  );

  if (overviewQ.isLoading) return <LoadingBlock label="Loading registration…" />;
  if (overviewQ.isError) return <ErrorBlock error={overviewQ.error} />;
  const ov = overviewQ.data!;

  return (
    <div className="space-y-4">
      {/* headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Seats held" value={ov.stats.heldSeats} sub={ov.event.registrationCapacity != null ? `of ${ov.event.registrationCapacity}` : "no overall cap"} tone="positive" icon={Ticket} />
        <StatCard label="Awaiting payment" value={ov.stats.pendingOrders} sub={`${ov.stats.pendingSeats} seat(s)`} tone="warning" icon={Banknote} />
        <StatCard label="Waitlisted" value={ov.stats.waitlistOrders} sub={`${ov.stats.waitlistSeats} seat(s)`} icon={Hourglass} />
        <StatCard label="Checked in" value={ov.stats.checkedInSeats} sub={`${fmtNaira(ov.stats.revenueCents)} collected`} icon={ScanLine} />
      </div>

      {canManage ? (
        <RegistrationSettingsCard eventId={eventId} overview={ov} />
      ) : (
        !ov.event.registrationEnabled ? (
          <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Registration is currently off for this event.
          </p>
        ) : null
      )}

      {/* ticket types — visible to viewers, editable for managers */}
      <Section
        title="Ticket types"
        description="Free types are RSVP-only; priced types collect payment before confirmation."
      >
        {ov.ticketTypes.length === 0 ? (
          <EmptyState icon={Ticket} title="No ticket types yet" description="Add a free RSVP list or priced tickets." />
        ) : (
          <div className="space-y-2">
            {ov.ticketTypes.map((t) => (
              <TicketTypeRow key={t.id} eventId={eventId} tt={t} canManage={canManage} />
            ))}
          </div>
        )}
        {canManage ? <AddTicketTypeDialog eventId={eventId} nextSort={ov.ticketTypes.length} /> : null}
      </Section>

      {canManage ? <CheckInSection eventId={eventId} eventName={ov.event.name} startsAt={startsAt} /> : null}

      <Section
        title="Orders"
        description="Every RSVP or ticket order — members and guests."
        actions={
          canManage ? <AddRegistrationDialog eventId={eventId} overview={ov} /> : undefined
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-44" aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["confirmed", "pending_payment", "waitlist", "cancelled"].map((s) => (
                <SelectItem key={s} value={s}>
                  {REG_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, email, phone…"
            className="sm:max-w-xs"
            aria-label="Search orders"
          />
        </div>

        {regsQ.isLoading ? (
          <LoadingBlock label="Loading orders…" />
        ) : regsQ.isError ? (
          <ErrorBlock error={regsQ.error} />
        ) : (regsQ.data?.items ?? []).length === 0 ? (
          <EmptyState icon={Ticket} title="No orders yet" description="Registrations appear here as people sign up." />
        ) : (
          <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border">
            <div className="divide-y">
              {(regsQ.data?.items ?? []).map((r) => (
                <OrderRow key={r.id} eventId={eventId} r={r} canManage={canManage} />
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ── settings ── */

function RegistrationSettingsCard({ eventId, overview }: { eventId: string; overview: RegOverview }) {
  const qc = useQueryClient();
  const ev = overview.event;
  const [enabled, setEnabled] = useState(ev.registrationEnabled);
  const [capacity, setCapacity] = useState(ev.registrationCapacity != null ? String(ev.registrationCapacity) : "");
  const [deadline, setDeadline] = useState(ev.registrationDeadline ? toLocalInput(new Date(ev.registrationDeadline)) : "");
  const [note, setNote] = useState(ev.registrationNote ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(ev.registrationEnabled);
    setCapacity(ev.registrationCapacity != null ? String(ev.registrationCapacity) : "");
    setDeadline(ev.registrationDeadline ? toLocalInput(new Date(ev.registrationDeadline)) : "");
    setNote(ev.registrationNote ?? "");
  }, [ev.registrationEnabled, ev.registrationCapacity, ev.registrationDeadline, ev.registrationNote]);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/events/${eventId}/registration`, {
        registrationEnabled: enabled,
        registrationCapacity: capacity ? Math.round(Number(capacity)) : null,
        registrationDeadline: deadline ? new Date(deadline).toISOString() : null,
        registrationNote: note.trim() || null,
      });
      toast.success("Registration settings saved.");
      void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not save registration settings."));
    } finally {
      setBusy(false);
    }
  }

  const capNum = capacity ? Number(capacity) : null;
  const capInvalid = capNum != null && (!Number.isFinite(capNum) || capNum < 1);
  const overbooked = capNum != null && overview.stats.heldSeats > capNum;

  return (
    <Section title="Registration setup" description="Open RSVP/ticketing, set the seat cap and the member deadline.">
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="reg-enabled">Registration open</Label>
            <p className="text-xs text-muted-foreground">Members can RSVP from their portal; staff can always register people here.</p>
          </div>
          <Switch id="reg-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reg-capacity">Total seat cap</Label>
            <Input
              id="reg-capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 300 (blank = unlimited)"
            />
            {overbooked ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {overview.stats.heldSeats} seats already held — above this cap. Extra orders will waitlist.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-deadline">Member deadline</Label>
            <Input
              id="reg-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-note">Note to members (shown in the portal)</Label>
          <Textarea
            id="reg-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Free buses leave from the main gate at 5pm."
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy || capInvalid}>Save settings</Button>
        </div>
      </div>
    </Section>
  );
}

/* ── ticket types ── */

function TicketTypeRow({ eventId, tt, canManage }: { eventId: string; tt: TicketTypeDTO; canManage: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await api.put(`/events/${eventId}/ticket-types/${tt.id}`, { isActive: !tt.isActive });
      toast.success(tt.isActive ? "Ticket type deactivated." : "Ticket type re-activated.");
      void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the ticket type."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {tt.name}
          {tt.priceCents === 0 ? (
            <Badge variant="outline">Free</Badge>
          ) : (
            <Badge variant="outline">{fmtNaira(tt.priceCents)}</Badge>
          )}
          {!tt.isActive ? <Badge variant="outline" className="text-muted-foreground">Inactive</Badge> : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {tt.soldCount} sold
          {tt.capacity != null ? ` of ${tt.capacity}` : ""}
          {` · max ${tt.maxPerOrder}/order`}
          {tt.salesEndAt ? ` · sales close ${fmtDateTime(tt.salesEndAt)}` : ""}
          {tt.description ? ` — ${tt.description}` : ""}
        </p>
      </div>
      {canManage ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={toggleActive}>
          {tt.isActive ? "Deactivate" : "Activate"}
        </Button>
      ) : null}
    </div>
  );
}

function AddTicketTypeDialog({ eventId, nextSort }: { eventId: string; nextSort: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceNaira, setPriceNaira] = useState("0");
  const [capacity, setCapacity] = useState("");
  const [maxPerOrder, setMaxPerOrder] = useState("2");
  const [salesEnd, setSalesEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const priceCents = nairaToCents(priceNaira);
  const valid =
    name.trim().length > 0 &&
    priceCents != null &&
    (!capacity || Number(capacity) >= 1) &&
    Number(maxPerOrder) >= 1;

  async function submit() {
    if (priceCents == null) return;
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/ticket-types`, {
        name: name.trim(),
        description: description.trim() || undefined,
        priceCents,
        capacity: capacity ? Math.round(Number(capacity)) : null,
        maxPerOrder: Math.round(Number(maxPerOrder)) || 2,
        salesEndAt: salesEnd ? new Date(salesEnd).toISOString() : null,
        isActive: true,
        sortOrder: nextSort,
      });
      toast.success("Ticket type added.");
      setOpen(false);
      setName("");
      setDescription("");
      setPriceNaira("0");
      setCapacity("");
      setMaxPerOrder("2");
      setSalesEnd("");
      void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not add the ticket type."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" className="mt-2 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> New ticket type
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New ticket type</DialogTitle>
            <DialogDescription>Set the price to 0 for a free RSVP list.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tt-name">Name</Label>
              <Input id="tt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Regular / VIP / Student" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-desc">Description (optional)</Label>
              <Input id="tt-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Includes dinner and parking" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tt-price">Price (₦)</Label>
                <Input id="tt-price" type="number" min={0} value={priceNaira} onChange={(e) => setPriceNaira(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tt-capacity">Capacity (blank = event cap only)</Label>
                <Input id="tt-capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 100" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tt-max">Max seats / order</Label>
                <Input id="tt-max" type="number" min={1} max={10} value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tt-salesend">Sales close (optional)</Label>
                <Input id="tt-salesend" type="datetime-local" value={salesEnd} onChange={(e) => setSalesEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || busy}>Add ticket type</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── QR check-in ── */

function CheckInSection({ eventId, eventName, startsAt }: { eventId: string; eventName: string; startsAt: string }) {
  const qc = useQueryClient();
  const [scanOpen, setScanOpen] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);

  const handleToken = useCallback(
    async (token: string) => {
      try {
        const res = await api.post<{
          ok: boolean;
          alreadyDone: boolean;
          name: string;
          eventName: string;
          ticketTypeName?: string;
          seatsTotal: number;
          seatsCheckedIn: number;
        }>("/events/check-in", { qrToken: token });
        setResults((prev) =>
          [
            {
              name: res.name,
              eventName: res.eventName,
              ticketTypeName: res.ticketTypeName,
              seatsTotal: res.seatsTotal,
              seatsCheckedIn: res.seatsCheckedIn,
              alreadyDone: res.alreadyDone,
              at: new Date().toISOString(),
            },
            ...prev,
          ].slice(0, 8)
        );
        if (res.alreadyDone) {
          toast.info(`${res.name} — all ${res.seatsTotal} seat(s) already checked in.`);
        } else {
          toast.success(`Checked in ${res.name} (${res.seatsCheckedIn}/${res.seatsTotal}).`);
        }
        void qc.invalidateQueries({ queryKey: ["events", "registrations", eventId] });
        void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
      } catch (err) {
        toast.error(errorMessage(err, "Check-in failed."));
      }
    },
    [eventId, qc]
  );

  return (
    <Section
      title="Door check-in"
      description="Scan the ticket QR or type its 6-digit code — each scan admits one seat (family orders scan per person)."
    >
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setKioskOpen(true)} className="gap-1.5">
            <MonitorPlay className="h-4 w-4" aria-hidden /> Launch kiosk mode
          </Button>
          <Button variant="outline" onClick={() => setScanOpen(true)} className="gap-1.5">
            <ScanLine className="h-4 w-4" aria-hidden /> Quick scan
          </Button>
          <p className="text-xs text-muted-foreground">
            Kiosk is a full-screen door station for this event — QR camera plus 6-digit code entry.
          </p>
        </div>
        {results.length ? (
          <ul className="space-y-1.5">
            {results.map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground"> · {r.eventName}</span>
                  {r.ticketTypeName ? <span className="text-muted-foreground"> · {r.ticketTypeName}</span> : null}
                </span>
                <Badge variant="outline" className={r.alreadyDone ? "" : "border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200"}>
                  {r.alreadyDone ? "Already in" : `${r.seatsCheckedIn}/${r.seatsTotal}`}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onToken={(t) => void handleToken(t)} />
      <EventDoorKiosk
        open={kioskOpen}
        onOpenChange={setKioskOpen}
        eventId={eventId}
        eventName={eventName}
        startsAt={startsAt}
      />
    </Section>
  );
}

/* ── orders list ── */

function OrderRow({ eventId, r, canManage }: { eventId: string; r: RegistrationDTO; canManage: boolean }) {
  const qc = useQueryClient();
  const [qrOpen, setQrOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await api.post(`/registrations/${r.id}/cancel`);
      toast.success("Order cancelled.");
      setCancelOpen(false);
      void qc.invalidateQueries({ queryKey: ["events", "registrations", eventId] });
      void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not cancel the order."));
    } finally {
      setBusy(false);
    }
  }

  const canCancel = canManage && r.status !== "cancelled" && r.checkedInSeats === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {r.name}
          {r.isGuest ? <Badge variant="outline" className="text-muted-foreground">Guest</Badge> : null}
          <Badge variant="outline" className={`border-transparent ${REG_TONES[r.status] ?? ""}`}>
            {REG_LABELS[r.status] ?? r.status}
          </Badge>
          {r.checkedInSeats > 0 ? (
            <Badge variant="outline" className="border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200">
              {r.checkedInSeats}/{r.quantity} in
            </Badge>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {r.ticketTypeName} · {r.quantity} seat{r.quantity === 1 ? "" : "s"}
          {r.amountDueCents > 0
            ? r.amountPaidCents >= r.amountDueCents
              ? ` · paid ${fmtNaira(r.amountPaidCents)}${r.paymentMethod ? ` (${PAY_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod})` : ""}`
              : ` · due ${fmtNaira(r.amountDueCents - r.amountPaidCents)}`
            : ""}
          {r.guestEmail ? ` · ${r.guestEmail}` : ""}
          {` · by ${r.createdByName ?? "—"}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {r.qrToken && r.status !== "cancelled" && r.status !== "waitlist" ? (
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Show QR for ${r.name}`} onClick={() => setQrOpen(true)}>
            <QrCode className="h-4 w-4" />
          </Button>
        ) : null}
        {canManage && r.status === "pending_payment" ? (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setPayOpen(true)}>
            <Banknote className="h-3.5 w-3.5" aria-hidden /> Payment
          </Button>
        ) : null}
        {canCancel ? (
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Cancel order for ${r.name}`} onClick={() => setCancelOpen(true)}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <QrTicketDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        token={r.qrToken ?? null}
        title={`Ticket — ${r.name}`}
        description={`${r.ticketTypeName} · ${r.quantity} seat(s) · ${REG_LABELS[r.status] ?? r.status}`}
      />
      <RecordPaymentDialog eventId={eventId} r={r} open={payOpen} onOpenChange={setPayOpen} />
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel order for {r.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {r.quantity} seat(s) on “{r.ticketTypeName}” are released. Waitlisted orders are promoted automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void cancel();
              }}
              disabled={busy}
            >
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RecordPaymentDialog({
  eventId,
  r,
  open,
  onOpenChange,
}: {
  eventId: string;
  r: RegistrationDTO;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/registrations/${r.id}/confirm-payment`, {
        method,
        reference: reference.trim() || undefined,
      });
      toast.success(`Payment recorded for ${r.name}.`);
      onOpenChange(false);
      setReference("");
      void qc.invalidateQueries({ queryKey: ["events", "registrations", eventId] });
      void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment — {r.name}</DialogTitle>
          <DialogDescription>
            {fmtNaira(r.amountDueCents - r.amountPaidCents)} due · {r.ticketTypeName} · {r.quantity} seat(s)
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="pay-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="transfer">Bank transfer</SelectItem>
                <SelectItem value="demo_card">Card (demo charge)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer id / receipt no." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Confirm payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── staff: add a registration ── */

function AddRegistrationDialog({ eventId, overview }: { eventId: string; overview: RegOverview }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<"member" | "guest">("member");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const activeTypes = overview.ticketTypes.filter((t) => t.isActive);
  const [ticketTypeId, setTicketTypeId] = useState("none");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const peopleQ = useApiQuery<{ items: PersonListItem[] }>(
    ["people-search", "reg", search],
    `/people${qs({ search, pageSize: 8 })}`,
    { enabled: who === "member" && search.trim().length >= 2 }
  );

  const selectedType = ticketTypeId === "none" ? null : activeTypes.find((t) => t.id === ticketTypeId) ?? null;
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const dueCents = selectedType ? selectedType.priceCents * qty : 0;
  const maxQty = selectedType?.maxPerOrder ?? 10;

  const valid = who === "member" ? !!person : guestName.trim().length > 0;

  async function submit() {
    setBusy(true);
    try {
      const resp = await api.post<{ id: string; status: string; amountDueCents: number; quantity: number }>(
        `/events/${eventId}/registrations`,
        {
          personId: who === "member" ? person!.id : undefined,
          guestName: who === "guest" ? guestName.trim() : undefined,
          guestEmail: who === "guest" ? guestEmail.trim() || undefined : undefined,
          guestPhone: who === "guest" ? guestPhone.trim() || undefined : undefined,
          ticketTypeId: ticketTypeId === "none" ? undefined : ticketTypeId,
          quantity: qty,
          notes: notes.trim() || undefined,
        }
      );
      if (resp.status === "waitlist") {
        toast.info("Added to the waitlist — the event or ticket type is full.");
      } else if (resp.status === "pending_payment") {
        toast.success(`Registered — ${fmtNaira(resp.amountDueCents)} awaiting payment.`);
      } else {
        toast.success("Registration confirmed.");
      }
      setOpen(false);
      setPerson(null);
      setSearchInput("");
      setGuestName("");
      setGuestEmail("");
      setGuestPhone("");
      setTicketTypeId("none");
      setQuantity("1");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["events", "registrations", eventId] });
      void qc.invalidateQueries({ queryKey: ["events", "registration", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not register the attendee."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden /> Register attendee
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register an attendee</DialogTitle>
            <DialogDescription>Members get a portal ticket; guests get a door ticket by name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reg-who">Attendee</Label>
              <Select value={who} onValueChange={(v) => setWho(v as "member" | "guest")}>
                <SelectTrigger id="reg-who">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member (from directory)</SelectItem>
                  <SelectItem value="guest">Guest (name only)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {who === "member" ? (
              <div className="space-y-1.5">
                <Label htmlFor="reg-person">Find the member</Label>
                {person ? (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span>
                      {person.firstName} {person.lastName}
                      <span className="ml-1.5 text-xs text-muted-foreground">{person.lifecycleStage.replace(/_/g, " ")}</span>
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Change member" onClick={() => setPerson(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      id="reg-person"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Type at least 2 characters…"
                      autoComplete="off"
                    />
                    {search.trim().length >= 2 ? (
                      <div className="max-h-40 overflow-y-auto scroll-slim rounded-md border">
                        {peopleQ.isLoading ? (
                          <LoadingBlock label="Searching…" />
                        ) : (peopleQ.data?.items ?? []).length === 0 ? (
                          <p className="px-3 py-2 text-sm text-muted-foreground">No matching people.</p>
                        ) : (
                          (peopleQ.data?.items ?? []).map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
                              onClick={() => {
                                setPerson(p);
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
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-guest-name">Guest name</Label>
                  <Input id="reg-guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-guest-email">Email (optional)</Label>
                    <Input id="reg-guest-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-guest-phone">Phone (optional)</Label>
                    <Input id="reg-guest-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reg-type">Ticket type</Label>
                <Select value={ticketTypeId} onValueChange={setTicketTypeId}>
                  <SelectTrigger id="reg-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General admission</SelectItem>
                    {activeTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — {t.priceCents === 0 ? "Free" : fmtNaira(t.priceCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-qty">Seats</Label>
                <Input
                  id="reg-qty"
                  type="number"
                  min={1}
                  max={maxQty}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            {selectedType && dueCents > 0 ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <Banknote className="mr-1.5 inline h-4 w-4 text-muted-foreground" aria-hidden />
                {fmtNaira(dueCents)} will be due before the ticket is confirmed.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="reg-notes">Notes (optional)</Label>
              <Input id="reg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. arriving late, wheelchair access" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || busy}>
              {selectedType && dueCents > 0 ? "Register (payment due)" : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ═══════════════════════ Program / run-sheet ═══════════════════════ */

interface ProgramItemDTO {
  id: string;
  title: string;
  speaker: string | null;
  startsAt: string;
  endsAt: string;
  roomText: string | null;
  notes: string | null;
}

function ProgramPanel({ eventId, eventStartsAt, canManage }: { eventId: string; eventStartsAt: string; canManage: boolean }) {
  const qc = useQueryClient();
  const programQ = useApiQuery<{ items: ProgramItemDTO[] }>(
    ["events", "program", eventId],
    `/events/${eventId}/program`
  );
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(itemId: string) {
    setBusyId(itemId);
    try {
      await api.del(`/events/${eventId}/program/${itemId}`);
      toast.success("Program item removed.");
      void qc.invalidateQueries({ queryKey: ["events", "program", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove the item."));
    } finally {
      setBusyId(null);
    }
  }

  const items = programQ.data?.items ?? [];
  // group by calendar day
  const byDay = new Map<string, ProgramItemDTO[]>();
  for (const it of items) {
    const day = fmtDate(it.startsAt);
    const arr = byDay.get(day) ?? [];
    arr.push(it);
    byDay.set(day, arr);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Run-sheet for the gathering — conventions, retreats and special services plan every segment here.
        </p>
        {canManage ? <Button variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Add item
        </Button> : null}
      </div>

      {programQ.isLoading ? (
        <LoadingBlock label="Loading program…" />
      ) : programQ.isError ? (
        <ErrorBlock error={programQ.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No program yet"
          description="Add segments with times and speakers to build the run-sheet."
        />
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, dayItems]) => (
            <div key={day} className="rounded-lg border">
              <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {day}
              </div>
              <div className="divide-y">
                {dayItems.map((it) => (
                  <div key={it.id} className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {it.title}
                        {it.speaker ? <span className="ml-1.5 text-xs text-muted-foreground">· {it.speaker}</span> : null}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden />
                        {fmtTime(it.startsAt)} – {fmtTime(it.endsAt)}
                        {it.roomText ? (
                          <>
                            <MapPin className="ml-1 h-3 w-3" aria-hidden /> {it.roomText}
                          </>
                        ) : null}
                      </p>
                      {it.notes ? <p className="mt-1 text-xs text-muted-foreground">{it.notes}</p> : null}
                    </div>
                    {canManage ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        aria-label={`Remove ${it.title}`}
                        disabled={busyId === it.id}
                        onClick={() => void remove(it.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddProgramItemDialog
        eventId={eventId}
        eventStartsAt={eventStartsAt}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}

function AddProgramItemDialog({
  eventId,
  eventStartsAt,
  open,
  onOpenChange,
}: {
  eventId: string;
  eventStartsAt: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date(eventStartsAt)));
  const [endsAt, setEndsAt] = useState(() =>
    toLocalInput(new Date(new Date(eventStartsAt).getTime() + 60 * 60000))
  );
  const [roomText, setRoomText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 0 && startsAt && endsAt && new Date(endsAt) > new Date(startsAt);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/program`, {
        title: title.trim(),
        speaker: speaker.trim() || undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        roomText: roomText.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success("Program item added.");
      onOpenChange(false);
      setTitle("");
      setSpeaker("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["events", "program", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not add the program item."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-slim sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add program item</DialogTitle>
          <DialogDescription>One segment of the run-sheet — a session, break or ministration.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="prog-title">Title</Label>
            <Input id="prog-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Word ministration" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-speaker">Speaker / lead (optional)</Label>
            <Input id="prog-speaker" value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Pastor David O." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prog-starts">Starts</Label>
              <Input id="prog-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prog-ends">Ends</Label>
              <Input id="prog-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-room">Venue / room (optional)</Label>
            <Input id="prog-room" value={roomText} onChange={(e) => setRoomText(e.target.value)} placeholder="Main auditorium" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-notes">Notes (optional)</Label>
            <Input id="prog-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Choir backup, live stream…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || busy}>Add item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
