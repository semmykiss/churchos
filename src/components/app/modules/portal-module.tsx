"use client";

/**
 * Member portal — Aisha's phone-first self-service.
 * Giving (only when visible), serving schedule with respond, groups, family,
 * preferences with a consent ledger, and prayer requests.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bell, CalendarDays, CheckCircle2, Gift, Heart, Mail, MapPin, MessageSquare, Pencil, Send, Users,
} from "lucide-react";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// ── local shapes ─────────────────────────────────────────────────────────────
interface PortalMe {
  person: {
    id: string; name: string; firstName?: string; email: string | null; phone: string | null;
    household: { id: string; name: string; members: { personId: string; name: string; role: string }[] } | null;
    tags: { id: string; name: string; color: string }[];
  };
  giving: {
    visible: boolean; ytdCents: number | null;
    recent: { id: string; amountCents: number; method: string; status: string; receivedOn: string; funds: { name: string; amountCents: number }[] }[];
    recurring: { id: string; fund: string; amountCents: number; frequency: string; nextRunAt: string; status: string }[];
  };
  groups: { id: string; name: string; role: string; meetingDay: string | null; meetingTime: string | null; locationText: string | null }[];
  schedule: { id: string; roleName: string; eventName: string; startsAt: string; status: string; callTime: string | null }[];
  children: { personId: string; name: string; age?: number; room: string }[];
  prayerRequests: { id: string; body: string; audience: string; status: string; isAnonymous: boolean; createdAt: string; expiresAt: string | null }[];
  consents: { channel: string; category: string; optedIn: boolean }[];
  upcomingEvents: { id: string; name: string; startsAt: string }[];
}
interface FundLite { id: string; name: string; isActive?: boolean; }

const AUDIENCES = [
  { value: "private", label: "Private" },
  { value: "group", label: "Group" },
  { value: "staff", label: "Staff" },
  { value: "church", label: "Church-wide" },
] as const;

function errMsg(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.";
}
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
/** callTime arrives as "HH:mm" (not ISO) — format 12h without Date parsing. */
function fmtCallTime(t?: string | null): string {
  if (!t) return "";
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

// ── module ───────────────────────────────────────────────────────────────────
import { MyAvailabilityCard } from "@/components/app/portal/my-availability";

export default function PortalModule({ user }: ModuleProps) {
  const queryClient = useQueryClient();
  const meQ = useApiQuery<PortalMe>(["portal", "me"], "/portal/me");

  const [profileOpen, setProfileOpen] = useState(false);
  const [giveOpen, setGiveOpen] = useState(false);
  const [prayerOpen, setPrayerOpen] = useState(false);

  const me = meQ.data;
  const firstName = me?.person.firstName ?? me?.person.name.split(" ")[0] ?? user.name.split(" ")[0];
  // Funds come from portal/me (portal-scoped) — members can give without staff permission.
  const portalFunds: FundLite[] = (me?.giving as unknown as { funds?: { id: string; name: string }[] })?.funds ?? [];
  const showGiving = !!me?.giving.visible;

  const consentMut = useMutation({
    mutationFn: (input: { channel: string; category: string; optedIn: boolean }) =>
      api.post("/portal/me/consent", input),
    onSuccess: () => {
      toast.success("Saved — consent ledger updated");
      queryClient.invalidateQueries({ queryKey: ["portal", "me"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const respondMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      api.post(`/assignments/${id}/respond`, { action }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "accept" ? "You're confirmed — see you Sunday!" : "Declined — thanks for letting us know.");
      queryClient.invalidateQueries({ queryKey: ["portal", "me"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={`${user.orgName} · your groups, serving schedule, and preferences in one place.`}
        actions={<Button variant="outline" size="sm" onClick={() => setProfileOpen(true)}><Pencil /> Edit profile</Button>}
      />

      {meQ.isLoading ? <LoadingBlock label="Loading your info…" />
        : meQ.error ? <ErrorBlock error={meQ.error} />
        : !me ? null : (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* My giving */}
            {showGiving ? (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">My giving</CardTitle>
                  <Button size="sm" onClick={() => setGiveOpen(true)}><Gift /> Give</Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-3xl font-semibold tabular-nums text-teal-700 dark:text-teal-400">{fmtMoney(me.giving.ytdCents)}</p>
                    <p className="text-xs text-muted-foreground">given year-to-date</p>
                  </div>
                  {me.giving.recurring.filter((r) => r.status === "active").length ? (
                    <p className="text-xs text-muted-foreground">
                      {me.giving.recurring.filter((r) => r.status === "active").length} recurring gift(s) active — next run {fmtDate(me.giving.recurring.find((r) => r.status === "active")?.nextRunAt)}.
                    </p>
                  ) : null}
                  {me.giving.recent.length ? (
                    <ul className="max-h-40 space-y-1.5 overflow-y-auto scroll-slim">
                      {me.giving.recent.map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-muted-foreground">
                            {g.funds.map((f) => f.name).join(", ") || "Gift"} · {fmtDate(g.receivedOn)}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="font-medium tabular-nums">{fmtMoney(g.amountCents)}</span>
                            <StatusBadge status={g.status} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">No gifts recorded yet this year.</p>}
                </CardContent>
              </Card>
            ) : null}

            {/* My schedule */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden /> My schedule</CardTitle></CardHeader>
              <CardContent>
                {me.schedule.length ? (
                  <ul className="max-h-64 space-y-2 overflow-y-auto scroll-slim">
                    {me.schedule.map((s) => (
                      <li key={s.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{s.roleName}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.eventName} · {fmtDateTime(s.startsAt)}
                              {s.callTime ? ` · call time ${fmtCallTime(s.callTime)}` : ""}
                            </p>
                          </div>
                          <StatusBadge status={s.status} />
                        </div>
                        {s.status === "asked" ? (
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ id: s.id, action: "accept" })}>
                              <CheckCircle2 /> Accept
                            </Button>
                            <Button size="sm" variant="outline" disabled={respondMut.isPending} onClick={() => respondMut.mutate({ id: s.id, action: "decline" })}>
                              Decline
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={CalendarDays} title="Nothing on your schedule" description="When you're rostered to serve, it shows up here." />}
              </CardContent>
            </Card>

            {/* My serving availability — self-service (server-enforced to own record; hidden without serving.view.own) */}
            <MyAvailabilityCard />

            {/* My groups */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-muted-foreground" aria-hidden /> My groups</CardTitle></CardHeader>
              <CardContent>
                {me.groups.length ? (
                  <ul className="space-y-2">
                    {me.groups.map((g) => (
                      <li key={g.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{g.name}</p>
                          <Badge variant="outline" className="capitalize">{g.role}</Badge>
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {g.meetingDay ? <span>{capitalize(g.meetingDay)}{g.meetingTime ? ` · ${g.meetingTime}` : ""}</span> : null}
                          {g.locationText ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {g.locationText}</span> : null}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={Users} title="You're not in a group yet" description="Groups are the best way to belong — ask a pastor to connect you." />}
              </CardContent>
            </Card>

            {/* My family */}
            <Card>
              <CardHeader><CardTitle className="text-base">My family</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {me.person.household ? (
                  <div>
                    <p className="mb-2 text-sm font-medium">{me.person.household.name}</p>
                    <ul className="flex flex-wrap gap-2">
                      {me.person.household.members.map((m) => (
                        <li key={m.personId} className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3">
                          <PersonAvatar name={m.name} className="h-7 w-7 text-[10px]" />
                          <span className="text-sm">{m.name}</span>
                          <Badge variant="secondary" className="capitalize">{m.role}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="text-sm text-muted-foreground">No household linked yet.</p>}

                {me.children.length ? (
                  <div>
                    <p className="mb-2 text-sm font-medium">Children</p>
                    <ul className="flex flex-wrap gap-2">
                      {me.children.map((c) => (
                        <li key={c.personId} className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-200">
                          {c.name}
                          <Badge variant="outline" className="border-amber-300 bg-transparent text-amber-900 dark:border-amber-800 dark:text-amber-200">{c.room}</Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Only authorized guardians may pick up children — the room code is required at checkout.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Upcoming at church */}
            <Card>
              <CardHeader><CardTitle className="text-base">Upcoming at church</CardTitle></CardHeader>
              <CardContent>
                {me.upcomingEvents.length ? (
                  <ul className="space-y-2">
                    {me.upcomingEvents.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{e.name}</span>
                        <span className="text-xs text-muted-foreground">{fmtDateTime(e.startsAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="No upcoming services" />}
              </CardContent>
            </Card>

            {/* Preferences */}
            <Card>
              <CardHeader><CardTitle className="text-base">Preferences</CardTitle></CardHeader>
              <CardContent>
                {me.consents.length ? (
                  <ul className="space-y-2">
                    {me.consents.map((c) => {
                      const Icon = c.channel === "email" ? Mail : c.channel === "sms" ? MessageSquare : Bell;
                      const key = `${c.channel}-${c.category}`;
                      return (
                        <li key={key} className="flex items-center justify-between gap-3 rounded-md border p-3">
                          <span className="flex items-center gap-2 text-sm">
                            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                            <span className="font-medium capitalize">{c.channel}</span>
                            <span className="text-muted-foreground">· {capitalize(c.category)}</span>
                          </span>
                          <Switch
                            checked={c.optedIn}
                            aria-label={`${c.optedIn ? "Opted in" : "Opted out"}: ${c.channel} ${c.category}`}
                            disabled={consentMut.isPending}
                            onCheckedChange={(v) => consentMut.mutate({ channel: c.channel, category: c.category, optedIn: v })}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No communication preferences yet. We only message you when a consent exists — flip your first one from a link in any message.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Prayer requests */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base"><Heart className="h-4 w-4 text-muted-foreground" aria-hidden /> My prayer requests</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setPrayerOpen(true)}><Send /> Submit request</Button>
              </CardHeader>
              <CardContent>
                {me.prayerRequests.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {me.prayerRequests.map((p) => (
                      <li key={p.id} className="rounded-md border p-3">
                        <p className="text-sm">{p.body}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <StatusBadge status={p.status} />
                          <Badge variant="outline" className="capitalize">{p.audience}</Badge>
                          {p.isAnonymous ? <span>Anonymous</span> : null}
                          <span>· {fmtDate(p.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={Heart} title="No prayer requests" description="Share a need privately with pastors or with the church." />}
              </CardContent>
            </Card>
          </div>
        )}

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} email={me?.person.email ?? ""} phone={me?.person.phone ?? ""} />
      <GiveDialog open={giveOpen} onClose={() => setGiveOpen(false)} funds={portalFunds} />
      <PrayerDialog open={prayerOpen} onClose={() => setPrayerOpen(false)} />
    </div>
  );
}

// ── profile edit ─────────────────────────────────────────────────────────────
function ProfileDialog({ open, onClose, email, phone }: { open: boolean; onClose: () => void; email: string; phone: string }) {
  const queryClient = useQueryClient();
  const [emailV, setEmailV] = useState(email);
  const [phoneV, setPhoneV] = useState(phone);

  const mut = useMutation({
    mutationFn: () => api.put("/portal/me", { email: emailV.trim() || undefined, phone: phoneV.trim() || undefined }),
    onSuccess: () => {
      toast.success("Profile updated.");
      onClose();
      queryClient.invalidateQueries({ queryKey: ["portal", "me"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>You can update your own email and phone. Everything else is kept by the office.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pf-email">Email</Label>
            <Input id="pf-email" type="email" value={emailV} onChange={(e) => setEmailV(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-phone">Mobile phone</Label>
            <Input id="pf-phone" type="tel" value={phoneV} onChange={(e) => setPhoneV(e.target.value)} placeholder="(555) 010-1234" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── give flow ────────────────────────────────────────────────────────────────
const AMOUNT_CHIPS = [25, 50, 100, 250];

function GiveDialog({ open, onClose, funds }: { open: boolean; onClose: () => void; funds: FundLite[] }) {
  const queryClient = useQueryClient();
  const [chip, setChip] = useState<number | null>(50);
  const [custom, setCustom] = useState("");
  const [fundId, setFundId] = useState("");
  const [frequency, setFrequency] = useState("one_time");
  const [method, setMethod] = useState("card");
  const [done, setDone] = useState(false);

  const naira = custom.trim() !== "" ? Number(custom) : chip;
  const amountCents = naira != null && Number.isFinite(naira) && naira > 0 ? Math.round(naira * 100) : 0;

  const mut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; donationId: string }>("/portal/me/gift", { amountCents, fundId, method, frequency }),
    onSuccess: () => {
      setDone(true);
      queryClient.invalidateQueries({ queryKey: ["portal", "me"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const reset = () => { setChip(50); setCustom(""); setFundId(""); setFrequency("one_time"); setMethod("card"); setDone(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Give</DialogTitle>
          <DialogDescription>Demo processor — no card data is stored, only the method name.</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="rounded-full bg-teal-100 p-4 dark:bg-teal-950">
              <CheckCircle2 className="h-8 w-8 text-teal-700 dark:text-teal-400" aria-hidden />
            </div>
            <p className="font-medium">Thank you for your gift.</p>
            <p className="text-sm text-muted-foreground">{fmtMoney(amountCents)} · {frequency === "monthly" ? "Monthly" : "One-time"}</p>
            <p className="text-xs text-muted-foreground">Demo processor — no card data stored.</p>
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <div className="grid grid-cols-4 gap-2">
                {AMOUNT_CHIPS.map((a) => (
                  <button
                    key={a} type="button"
                    aria-pressed={chip === a && custom.trim() === ""}
                    className={cn(
                      "rounded-md border py-2 text-sm font-semibold transition-colors",
                      chip === a && custom.trim() === ""
                        ? "border-teal-700 bg-teal-700 text-white dark:bg-teal-600 dark:border-teal-600"
                        : "hover:bg-accent",
                    )}
                    onClick={() => { setChip(a); setCustom(""); }}
                  >
                    ${a}
                  </button>
                ))}
              </div>
              <Input
                type="number" min={1} step="1" placeholder="Custom amount (₦)"
                value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom amount in naira"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Fund</Label>
              <Select value={fundId} onValueChange={setFundId}>
                <SelectTrigger aria-label="Fund"><SelectValue placeholder="Choose a fund" /></SelectTrigger>
                <SelectContent>
                  {funds.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <RadioGroup value={frequency} onValueChange={setFrequency} className="grid grid-cols-2 gap-2">
                <Label htmlFor="freq-one" className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-normal has-[button[data-state=checked]]:border-teal-700">
                  <RadioGroupItem value="one_time" id="freq-one" /> One-time
                </Label>
                <Label htmlFor="freq-month" className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-normal has-[button[data-state=checked]]:border-teal-700">
                  <RadioGroupItem value="monthly" id="freq-month" /> Monthly
                </Label>
              </RadioGroup>
            </div>

            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="ach">Bank (ACH)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {!done ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button disabled={!amountCents || !fundId || mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? "Processing…" : `Give ${amountCents ? fmtMoney(amountCents) : ""}`}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── prayer request ───────────────────────────────────────────────────────────
function PrayerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("private");
  const [isAnonymous, setIsAnonymous] = useState(false);

  const mut = useMutation({
    mutationFn: () => api.post("/prayer-requests", { body: body.trim(), audience, isAnonymous }),
    onSuccess: () => {
      toast.success("Request submitted — thank you for sharing.");
      setBody(""); setAudience("private"); setIsAnonymous(false);
      onClose();
      queryClient.invalidateQueries({ queryKey: ["portal", "me"] });
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Submit a prayer request</DialogTitle>
          <DialogDescription>Private goes to pastors only; church-wide is reviewed before publishing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="portal-prayer-body">Request</Label>
            <Textarea id="portal-prayer-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What can we pray for?" />
          </div>
          <div className="space-y-1.5">
            <Label>Who can see it</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger aria-label="Audience"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="portal-prayer-anon" className="text-sm font-medium">Submit anonymously</Label>
              <p className="text-xs text-muted-foreground">Your name is hidden from the request.</p>
            </div>
            <Switch id="portal-prayer-anon" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!body.trim() || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Submitting…" : "Submit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
