"use client";

/**
 * Check-in module — two modes:
 *  • "Sunday" (staff): open/close kiosk sessions for a service, live room roster,
 *    staff override checkout (audited, reason required).
 *  • "Kiosk" (device mode): token-principal standalone flow — family lookup,
 *    child check-in with huge pickup codes, code-verified checkout, live roster.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { fmtDateTime, fmtTime, type EventDTO } from "@/lib/types";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  KeyRound,
  LogIn,
  LogOut,
  MonitorPlay,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

/* ───────────────────────────── API shapes ───────────────────────────── */

interface CheckinSessionDTO {
  id: string;
  eventId: string;
  name: string;
  opensAt: string;
  closesAt: string;
  kioskToken: string;
  eventName?: string;
  eventStartsAt?: string;
}

interface StaffGuardian {
  name: string;
  phone: string | null;
  authorizedPickup: boolean;
}

interface StaffRosterChild {
  personId: string;
  name: string;
  checkedInAt: string | null;
  pickupCode: string | null;
  allergies: string | null;
  guardians: StaffGuardian[];
}

interface StaffRosterResp {
  byRoom: { room: string; allergyCount: number; children: StaffRosterChild[] }[];
}

interface KioskChild {
  personId: string;
  name: string;
  age: number | null;
  room: string | null;
  allergies: string | null;
  hasActiveCheckin: boolean;
  activeCode: string | null;
}

interface KioskFamily {
  householdId: string;
  householdName: string;
  guardians: { personId: string; name: string }[];
  children: KioskChild[];
}

interface KioskCheckinRow {
  personId: string;
  name: string;
  room: string;
  pickupCode: string | null;
  allergies: string | null;
  checkedInAt: string | null;
}

interface KioskCheckinResp {
  checkins: KioskCheckinRow[];
  householdName: string | null;
}

interface KioskRosterResp {
  byRoom: { room: string; children: { name: string; checkedInAt: string | null; code: string | null }[] }[];
}

/* ───────────────────────────── helpers ───────────────────────────── */

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/* ───────────────────────────── module ───────────────────────────── */

export default function CheckinModule({ user: _user }: ModuleProps) {
  const [tab, setTab] = useState("sunday");
  const [pickedEventId, setPickedEventId] = useState<string | null>(null);

  // today → +7d, services only
  const from = startOfToday().toISOString();
  const to = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const eventsQ = useApiQuery<{ items: EventDTO[] }>(
    ["checkin-events", from],
    `/events${qs({ from, to, kind: "service" })}`
  );
  const events = useMemo(() => eventsQ.data?.items ?? [], [eventsQ.data]);

  const defaultEventId = useMemo(() => {
    if (!events.length) return null;
    const todayKey = new Date().toDateString();
    const todays = events.filter(
      (e) => new Date(e.startsAt).toDateString() === todayKey && e.status !== "cancelled"
    );
    if (todays.length) return todays[0].id;
    const upcoming = events.filter((e) => new Date(e.startsAt).getTime() >= Date.now());
    return (upcoming[0] ?? events[events.length - 1]).id;
  }, [events]);
  const eventId = pickedEventId ?? defaultEventId;
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;

  const sessionsQ = useApiQuery<{ items: CheckinSessionDTO[] }>(
    ["checkin-sessions"],
    "/checkin/sessions?active=true",
    { refetchInterval: 30000 }
  );
  const sessions = sessionsQ.data?.items ?? [];
  const session = sessions.find((s) => s.eventId === eventId) ?? null;

  const [kioskToken, setKioskToken] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in"
        description="Open kiosk check-in for today's service, watch the room roster live, and override checkouts when parents lose their codes."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sunday" className="gap-1.5">
            <Users className="h-4 w-4" /> Sunday
          </TabsTrigger>
          <TabsTrigger value="kiosk" className="gap-1.5">
            <MonitorPlay className="h-4 w-4" /> Kiosk
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sunday" className="mt-4 space-y-6">
          <SundayTab
            events={events}
            eventsQ={eventsQ}
            eventId={eventId}
            onPickEvent={setPickedEventId}
            sessionsQ={sessionsQ}
            session={session}
            onOpenKiosk={(token) => {
              setKioskToken(token);
              setTab("kiosk");
            }}
          />
        </TabsContent>

        <TabsContent value="kiosk" className="mt-4">
          {kioskToken ? (
            <KioskView token={kioskToken} onExit={() => setKioskToken(null)} />
          ) : (
            <KioskStart sessions={sessions} sessionsQ={sessionsQ} onStart={setKioskToken} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────────── Sunday (staff) ───────────────────────────── */

function SundayTab({
  events,
  eventsQ,
  eventId,
  onPickEvent,
  sessionsQ,
  session,
  onOpenKiosk,
}: {
  events: EventDTO[];
  eventsQ: ReturnType<typeof useApiQuery<{ items: EventDTO[] }>>;
  eventId: string | null;
  onPickEvent: (id: string) => void;
  sessionsQ: ReturnType<typeof useApiQuery<{ items: CheckinSessionDTO[] }>>;
  session: CheckinSessionDTO | null;
  onOpenKiosk: (token: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);

  async function openSession() {
    if (!eventId) return;
    setBusy(true);
    try {
      await api.post("/checkin/sessions", { eventId });
      toast.success("Check-in is open — the kiosk token is ready.");
      void qc.invalidateQueries({ queryKey: ["checkin-sessions"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not open check-in."));
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    if (!session) return;
    setBusy(true);
    try {
      await api.post(`/checkin/sessions/${session.id}/close`);
      toast.success("Check-in closed for this service.");
      void qc.invalidateQueries({ queryKey: ["checkin-sessions"] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not close check-in."));
    } finally {
      setBusy(false);
      setCloseConfirm(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Service
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {eventsQ.isLoading ? (
            <LoadingBlock label="Loading services…" />
          ) : eventsQ.isError && (eventsQ.error as { status?: number })?.status !== 403 ? (
            <ErrorBlock error={eventsQ.error} />
          ) : eventsQ.isError ? (
            /* Volunteers lack events.view — they work from open kiosk sessions instead. */
            <div className="text-sm text-muted-foreground">
              Staff service picker unavailable for your role — use the <strong>Kiosk</strong> tab to
              join an open check-in session.
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No services in the next 7 days"
              description="Create a service event from the Events module, then open check-in here."
            />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 sm:w-80">
                <Label htmlFor="service-pick">Service</Label>
                <Select value={eventId ?? undefined} onValueChange={onPickEvent}>
                  <SelectTrigger id="service-pick" className="w-full">
                    <SelectValue placeholder="Pick a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} — {fmtDateTime(e.startsAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {session ? (
                  <>
                    <Badge className="border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200">
                      Check-in open
                    </Badge>
                    <span
                      className="rounded-md border bg-muted/60 px-2 py-1 font-mono text-xs"
                      title="Kiosk token"
                    >
                      {session.kioskToken}
                    </span>
                    <Button
                      onClick={() => onOpenKiosk(session.kioskToken)}
                      className="gap-1.5"
                      aria-label="Open kiosk view for this session"
                    >
                      <MonitorPlay className="h-4 w-4" /> Open Kiosk view
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setCloseConfirm(true)}
                      disabled={busy}
                      aria-label="Close check-in for this service"
                    >
                      <LogOut className="h-4 w-4" /> Close check-in
                    </Button>
                  </>
                ) : (
                  <Button onClick={openSession} disabled={busy || !eventId} className="gap-1.5">
                    <LogIn className="h-4 w-4" /> Open check-in for this service
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {eventId ? <RoomRoster eventId={eventId} /> : null}

      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close check-in?</AlertDialogTitle>
            <AlertDialogDescription>
              Kiosks using this session token will stop accepting check-ins. Children already
              checked in stay on the roster until they are checked out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction onClick={closeSession}>Close check-in</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────────── staff room roster ───────────────────────────── */

function RoomRoster({ eventId }: { eventId: string }) {
  const rosterQ = useApiQuery<StaffRosterResp>(
    ["checkin-roster", eventId],
    `/checkin/roster${qs({ eventId })}`,
    { refetchInterval: 10000 }
  );

  if (rosterQ.isLoading) return <LoadingBlock label="Loading roster…" />;
  if (rosterQ.isError) return <ErrorBlock error={rosterQ.error} />;

  const rooms = rosterQ.data?.byRoom ?? [];
  const total = rooms.reduce((a, r) => a + r.children.length, 0);

  return (
    <section className="space-y-3" aria-label="Room roster">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Live room roster</h2>
        <Badge variant="outline" className="gap-1">
          <Users className="h-3 w-3" /> {total} checked in
        </Badge>
      </div>
      {rooms.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody checked in yet"
          description="Check-ins from the kiosk appear here in real time."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rooms.map((room) => (
            <Card key={room.room}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold">{room.room}</CardTitle>
                {room.allergyCount > 0 ? (
                  <Badge className="gap-1 border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> {room.allergyCount} allergy
                    {room.allergyCount === 1 ? "" : " alerts"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {room.children.length} in room
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {room.children.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Empty right now.</p>
                ) : (
                  room.children.map((c) => <RosterChildRow key={c.personId} child={c} eventId={eventId} />)
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function RosterChildRow({ child, eventId }: { child: StaffRosterChild; eventId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkout() {
    if (!reason.trim()) {
      toast.error("A reason is required for a staff override checkout.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/checkin/checkout", { childId: child.personId, eventId, reason: reason.trim() });
      toast.success(`${child.name} checked out (staff override, audited).`);
      setOpen(false);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["checkin-roster", eventId] });
    } catch (err) {
      toast.error(errorMessage(err, "Could not check out this child."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{child.name}</p>
          <p className="text-xs text-muted-foreground">In at {fmtTime(child.checkedInAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-md border bg-stone-50 px-3 py-1 font-mono text-lg tracking-[0.3em] dark:bg-stone-900"
            aria-label={`Security code ${child.pickupCode ?? "none"}`}
          >
            {child.pickupCode ?? "————"}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            aria-label={`Check out ${child.name} with override`}
          >
            Check out
          </Button>
        </div>
      </div>
      {child.allergies ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {child.allergies}
        </p>
      ) : null}
      {child.guardians.length ? (
        <div className="mt-2 space-y-0.5">
          {child.guardians.map((g, i) => (
            <p key={`${g.name}-${i}`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {g.authorizedPickup ? (
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-label="Authorized for pickup" />
              ) : (
                <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span>
                {g.name}
                {g.phone ? ` · ${g.phone}` : ""}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Override checkout for {child.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This bypasses the pickup code and is recorded in the audit log with your name. Use
              when a parent lost their code and you verified identity in person.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`override-reason-${child.personId}`}>Reason (required)</Label>
            <Input
              id={`override-reason-${child.personId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Verified parent at front desk"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void checkout();
              }}
              disabled={busy || !reason.trim()}
            >
              Check out {child.name.split(" ")[0] ?? "child"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────────── kiosk: start screen ───────────────────────────── */

function KioskStart({
  sessions,
  sessionsQ,
  onStart,
}: {
  sessions: CheckinSessionDTO[];
  sessionsQ: ReturnType<typeof useApiQuery<{ items: CheckinSessionDTO[] }>>;
  onStart: (token: string) => void;
}) {
  return (
    <div className="kiosk-mode mx-auto w-full max-w-xl py-8">
      <Card>
        <CardHeader className="items-center pb-2 text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-lg">
            <MonitorPlay className="h-5 w-5" /> Device kiosk mode
          </CardTitle>
          <p className="text-sm font-normal text-muted-foreground">
            Pick the check-in session this device should run. The device is authorized by its
            session token only — no staff login needed.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessionsQ.isLoading ? (
            <LoadingBlock label="Looking for open check-ins…" />
          ) : sessionsQ.isError ? (
            <ErrorBlock error={sessionsQ.error} />
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={LogIn}
              title="No open check-in sessions"
              description='A staff member must open check-in from the "Sunday" tab first.'
            />
          ) : (
            sessions.map((s) => {
              const expired = new Date(s.closesAt).getTime() < Date.now();
              return (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-lg font-semibold">{s.eventName ?? s.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Opens {fmtTime(s.opensAt)} · closes {fmtTime(s.closesAt)}
                      {expired ? " · expired" : ""}
                    </p>
                  </div>
                  <Button
                    className="touch-btn min-h-14 gap-2 text-lg"
                    disabled={expired}
                    onClick={() => onStart(s.kioskToken)}
                    aria-label={`Start kiosk for ${s.eventName ?? s.name}${expired ? " (expired)" : ""}`}
                  >
                    <MonitorPlay className="h-5 w-5" /> {expired ? "Expired" : "Start kiosk"}
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────────── kiosk: device view ───────────────────────────── */

function KioskView({ token, onExit }: { token: string; onExit: () => void }) {
  const [mode, setMode] = useState<"checkin" | "checkout">("checkin");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const familiesQ = useApiQuery<{ items: KioskFamily[] }>(
    ["kiosk-families", token, debounced],
    `/kiosk/families${qs({ token, q: debounced })}`,
    { enabled: debounced.trim().length >= 2 }
  );
  const searchReady = debounced.trim().length >= 2;
  const rosterQ = useApiQuery<KioskRosterResp>(["kiosk-roster", token], `/kiosk/roster${qs({ token })}`, {
    refetchInterval: 15000,
  });

  const roster = rosterQ.data?.byRoom ?? [];
  const totalIn = roster.reduce((a, r) => a + r.children.length, 0);

  return (
    <div className="kiosk-mode mx-auto w-full max-w-3xl space-y-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm">
          <MonitorPlay className="h-4 w-4" /> Kiosk running · token {token.slice(0, 10)}…
        </Badge>
        <Button variant="ghost" size="sm" onClick={onExit} aria-label="Exit kiosk mode">
          Exit kiosk
        </Button>
      </div>

      {/* mode toggle */}
      <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Kiosk mode">
        <Button
          variant={mode === "checkin" ? "default" : "outline"}
          className="touch-btn min-h-14 gap-2 text-lg"
          onClick={() => setMode("checkin")}
          aria-pressed={mode === "checkin"}
        >
          <LogIn className="h-5 w-5" /> Check in
        </Button>
        <Button
          variant={mode === "checkout" ? "default" : "outline"}
          className="touch-btn min-h-14 gap-2 text-lg"
          onClick={() => setMode("checkout")}
          aria-pressed={mode === "checkout"}
        >
          <LogOut className="h-5 w-5" /> Check out
        </Button>
      </div>

      {/* live roster mini-panel */}
      <Collapsible>
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            Live roster · <span className="font-semibold text-foreground">{totalIn}</span> checked in
          </span>
          <CollapsibleTrigger className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium hover:bg-muted" aria-label="Toggle live roster">
            Rooms <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="mt-2 max-h-48 space-y-2 overflow-y-auto scroll-slim rounded-lg border p-3">
            {rosterQ.isLoading ? (
              <LoadingBlock label="Loading roster…" />
            ) : roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">No children checked in yet.</p>
            ) : (
              roster.map((r) => (
                <div key={r.room} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{r.room}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.children.map((c) => c.name).join(", ") || "—"}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {r.children.length}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* family search */}
      <div className="space-y-2">
        <Label htmlFor="kiosk-search" className="text-base">
          Find your family
        </Label>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="kiosk-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Phone number or family name"
            className="h-14 pl-12 text-lg"
            autoComplete="off"
            inputMode="search"
          />
        </div>
      </div>

      {mode === "checkin" ? (
        <KioskCheckinFlow token={token} familiesQ={familiesQ} searchReady={searchReady} onDone={() => setQuery("")} />
      ) : (
        <KioskCheckoutFlow token={token} familiesQ={familiesQ} searchReady={searchReady} />
      )}
    </div>
  );
}

type FamiliesQuery = ReturnType<typeof useApiQuery<{ items: KioskFamily[] }>>;

function FamilyResults({
  familiesQ,
  searchReady,
  emptyHint,
  children,
}: {
  familiesQ: FamiliesQuery;
  searchReady: boolean;
  emptyHint?: string;
  children: (families: KioskFamily[]) => ReactNode;
}) {
  if (!searchReady)
    return <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">Start typing to find your family.</p>;
  if (familiesQ.isLoading) return <LoadingBlock label="Searching…" />;
  if (familiesQ.isError) return <ErrorBlock error={familiesQ.error} />;
  if (familiesQ.data && familiesQ.data.items.length === 0)
    return (
      <EmptyState icon={Search} title="No families matched" description={emptyHint ?? "Try the last 4 digits of a phone number, or a last name."} />
    );
  return <>{children(familiesQ.data?.items ?? [])}</>;
}

/* ── kiosk check-in flow ── */

function KioskCheckinFlow({ token, familiesQ, searchReady, onDone }: { token: string; familiesQ: FamiliesQuery; searchReady: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [householdOfChild, setHouseholdOfChild] = useState<Record<string, string>>({});
  const [guardianByHousehold, setGuardianByHousehold] = useState<Record<string, string>>({});
  const [result, setResult] = useState<KioskCheckinResp | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleChild(family: KioskFamily, child: KioskChild) {
    setSelected((prev) =>
      prev.includes(child.personId) ? prev.filter((id) => id !== child.personId) : [...prev, child.personId]
    );
    setHouseholdOfChild((prev) => ({ ...prev, [child.personId]: family.householdId }));
    setGuardianByHousehold((prev) =>
      prev[family.householdId]
        ? prev
        : { ...prev, [family.householdId]: family.guardians[0]?.personId ?? "" }
    );
  }

  async function submit() {
    setBusy(true);
    try {
      const firstHousehold = householdOfChild[selected[0] ?? ""];
      const resp = await api.post<KioskCheckinResp>(`/kiosk/checkin${qs({ token })}`, {
        childIds: selected,
        guardianPersonId: (firstHousehold && guardianByHousehold[firstHousehold]) || undefined,
      });
      setResult(resp);
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ["kiosk-families", token] });
      void qc.invalidateQueries({ queryKey: ["kiosk-roster", token] });
    } catch (err) {
      toast.error(errorMessage(err, "Check-in failed — please see a host."));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Card className="border-teal-300 dark:border-teal-800">
        <CardContent className="space-y-6 p-6 text-center">
          <p className="text-xl font-semibold">You're all set{result.householdName ? `, ${result.householdName}` : ""}!</p>
          {result.checkins.map((c) => (
            <div key={c.personId} className="rounded-xl border bg-stone-50 p-5 dark:bg-stone-900">
              <p className="text-lg font-semibold">{c.name}</p>
              <Badge variant="outline" className="mt-1">
                {c.room}
              </Badge>
              <p className="mt-3 text-4xl font-mono tracking-widest" aria-label={`Pickup code ${c.pickupCode ?? ""}`}>
                {c.pickupCode ?? "————"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Show this code at pickup</p>
              {c.allergies ? (
                <Alert className="mt-3 border-amber-300 bg-amber-50 text-left dark:border-amber-800 dark:bg-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
                  <AlertDescription className="text-amber-900 dark:text-amber-200">
                    Allergy on file: {c.allergies} — tell your room host.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ))}
          <Button
            className="touch-btn min-h-14 w-full text-lg"
            onClick={() => {
              setResult(null);
              onDone();
            }}
          >
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <FamilyResults familiesQ={familiesQ} searchReady={searchReady}>
        {(families) =>
          families.map((f) => (
            <Card key={f.householdId}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg">{f.householdName}</CardTitle>
                {f.guardians.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`guardian-${f.householdId}`} className="text-sm text-muted-foreground">
                      Dropping off with
                    </Label>
                    <Select
                      value={guardianByHousehold[f.householdId] ?? f.guardians[0]?.personId}
                      onValueChange={(v) =>
                        setGuardianByHousehold((prev) => ({ ...prev, [f.householdId]: v }))
                      }
                    >
                      <SelectTrigger id={`guardian-${f.householdId}`} className="w-52">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {f.guardians.map((g) => (
                          <SelectItem key={g.personId} value={g.personId}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {f.children.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No kids registered in this household.</p>
                ) : (
                  f.children.map((c) => {
                    const checked = selected.includes(c.personId);
                    return (
                      <label
                        key={c.personId}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                          checked ? "border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-950" : "hover:bg-muted/60"
                        } ${c.hasActiveCheckin ? "opacity-90" : ""}`}
                      >
                        <Checkbox
                          checked={c.hasActiveCheckin ? true : checked}
                          disabled={c.hasActiveCheckin}
                          onCheckedChange={() => toggleChild(f, c)}
                          aria-label={`Check in ${c.name}`}
                          className="h-6 w-6"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-lg font-medium">{c.name}</span>
                          <span className="block text-sm text-muted-foreground">
                            {c.age != null ? `Age ${c.age} · ` : ""}
                            {c.room ?? "No room assigned"}
                          </span>
                          {c.allergies ? (
                            <span className="mt-1 flex items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Allergies: {c.allergies}
                            </span>
                          ) : null}
                        </span>
                        {c.hasActiveCheckin ? (
                          <Badge className="border-transparent bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200">
                            Checked in · {c.activeCode}
                          </Badge>
                        ) : null}
                      </label>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ))
        }
      </FamilyResults>

      <Button
        className="touch-btn min-h-14 w-full gap-2 text-lg"
        disabled={selected.length === 0 || busy}
        onClick={submit}
      >
        <LogIn className="h-5 w-5" /> Check in {selected.length > 0 ? `(${selected.length})` : ""}
      </Button>
      {selected.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Tap the kids you're checking in.</p>
      ) : null}
    </div>
  );
}

/* ── kiosk checkout flow ── */

function KioskCheckoutFlow({ token, familiesQ, searchReady }: { token: string; familiesQ: FamiliesQuery; searchReady: boolean }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<{ personId: string; name: string; activeCode: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!picked) return;
    setBusy(true);
    try {
      await api.post(`/kiosk/checkout${qs({ token })}`, { childId: picked.personId, code: code.trim() });
      toast.success(`Checked out — see you, ${picked.name.split(" ")[0] ?? picked.name}!`);
      setPicked(null);
      setCode("");
      void qc.invalidateQueries({ queryKey: ["kiosk-families", token] });
      void qc.invalidateQueries({ queryKey: ["kiosk-roster", token] });
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 403
        ? "That code doesn't match. Ask a room host for help."
        : errorMessage(err, "Checkout failed — please see a host.");
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <FamilyResults familiesQ={familiesQ} searchReady={searchReady} emptyHint="Nobody is checked in yet — try a check-in first, or search another family.">
        {(families) =>
          families.map((f) => (
            <Card key={f.householdId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{f.householdName}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {f.children.filter((c) => c.hasActiveCheckin).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one from this household is checked in.</p>
                ) : (
                  f.children
                    .filter((c) => c.hasActiveCheckin)
                    .map((c) => {
                      const active = picked?.personId === c.personId;
                      return (
                        <button
                          key={c.personId}
                          type="button"
                          onClick={() => setPicked({ personId: c.personId, name: c.name, activeCode: c.activeCode })}
                          aria-pressed={active}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
                            active ? "border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-950" : "hover:bg-muted/60"
                          }`}
                        >
                          <span className="text-lg font-medium">{c.name}</span>
                          <span className="rounded-md border bg-stone-50 px-3 py-1 font-mono text-xl tracking-[0.3em] dark:bg-stone-900">
                            {c.activeCode ?? "————"}
                          </span>
                        </button>
                      );
                    })
                )}
              </CardContent>
            </Card>
          ))
        }
      </FamilyResults>

      {picked ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="pickup-code" className="text-base">
                Pickup code for {picked.name}
              </Label>
              <Input
                id="pickup-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="h-14 text-center text-2xl font-mono tracking-widest"
              />
            </div>
            <Button
              className="touch-btn min-h-14 w-full gap-2 text-lg"
              disabled={code.length !== 4 || busy}
              onClick={submit}
            >
              <KeyRound className="h-5 w-5" /> Check out {picked.name.split(" ")[0] ?? ""}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Tap the child you're picking up, then enter their pickup code.
        </p>
      )}
    </div>
  );
}
