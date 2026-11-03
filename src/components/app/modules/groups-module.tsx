"use client";

/**
 * Departments — directory of departments / classes / serve teams / ministries,
 * with HOD assignment, roster management, join requests, quick attendance take
 * and absences. Editing (name, HOD, roster) is gated by groups.manage — the
 * server re-checks every change.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarPlus, Check, ChevronRight, Clock, Crown, MapPin, Pencil, Plus,
  Search, UserPlus, Users, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, useApiQuery,
  type ModuleProps,
} from "@/components/app/shared";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtTime, type GroupDTO, type Paged, type PersonListItem } from "@/lib/types";

// ── Contract shapes ──────────────────────────────────────────────────────────

type GroupListItem = GroupDTO & { attendanceRate?: number | null };

interface GroupMember {
  personId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  status: string;
  joinedAt: string;
}
interface GroupDetail {
  group: GroupDTO;
  members: GroupMember[];
  joinRequests: { id: string; person: { id: string; name: string }; message?: string | null; createdAt: string }[];
  attendanceRate: number;
  absentees: { personId: string; name: string; weeksAbsent: number; lastSeen?: string | null }[];
  meetings: { id: string; startsAt: string; presentCount?: number | null }[];
}

const GROUP_TYPES = [
  { value: "small_group", label: "Small group" },
  { value: "class", label: "Class" },
  { value: "serve_team", label: "Serve team" },
  { value: "ministry", label: "Ministry" },
] as const;

const MEETING_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type AttendStatus = "present" | "absent" | "late";

function typeLabel(t: string): string {
  return GROUP_TYPES.find((g) => g.value === t)?.label ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function dayLabel(day?: string | null): string {
  if (!day) return "";
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** "18:30" → "6:30 PM" (spec: build a fixed Date, then fmtTime). */
function fmtClock(hhmm?: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":");
  const hh = Number(h);
  const mm = Number(m ?? "0");
  if (Number.isNaN(hh) || Number.isNaN(mm)) return hhmm;
  return fmtTime(new Date(2026, 0, 1, hh, mm));
}

function meetingPattern(g: Pick<GroupDTO, "meetingDay" | "meetingTime">): string {
  const parts = [dayLabel(g.meetingDay), fmtClock(g.meetingTime)].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No set meeting";
}

function errText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

/** Roster role badge — the group leader is displayed as HOD (Head of Department). */
function roleLabel(role: string): string {
  return role === "leader" ? "HOD" : role;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── HOD (Head of Department) picker — shared by new/edit dialogs ────────────

function HodPicker({ value, onChange, inputId }: {
  value: { id: string; name: string } | null;
  onChange: (p: { id: string; name: string } | null) => void;
  inputId: string;
}) {
  const [text, setText] = useState("");
  const search = useDebounced(text, 250);
  const peopleQ = useApiQuery<Paged<PersonListItem>>(
    ["people", "hod-picker", search],
    `/people${qs({ search: search || undefined, pageSize: 8 })}`,
  );
  const items = peopleQ.data?.items ?? [];

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>HOD (Head of Department)</Label>
      {value ? (
        <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <PersonAvatar name={value.name} className="h-6 w-6 text-[9px]" />
            <span className="truncate">{value.name}</span>
            <Badge variant="secondary" className="text-[10px]">HOD</Badge>
          </span>
          <Button
            type="button" variant="ghost" size="icon" className="h-6 w-6"
            aria-label="Remove HOD assignment"
            onClick={() => onChange(null)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id={inputId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search a person to set as HOD…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
          <ul className="max-h-44 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="HOD search results">
            {peopleQ.isLoading ? (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">Searching…</li>
            ) : items.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                {search ? "No matches." : "Start typing to search."}
              </li>
            ) : (
              items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: p.id, name: `${p.firstName} ${p.lastName}` });
                      setText("");
                    }}
                    className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <PersonAvatar name={`${p.firstName} ${p.lastName}`} className="h-6 w-6 text-[9px]" />
                    <span className="min-w-0 flex-1 truncate">{p.firstName} {p.lastName}</span>
                    <span className="max-w-36 truncate text-[11px] text-muted-foreground">{p.email ?? ""}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">The HOD leads this department and shows on the roster as its leader.</p>
    </div>
  );
}

// ── New department dialog ───────────────────────────────────────────────

function NewGroupDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("small_group");
  const [hod, setHod] = useState<{ id: string; name: string } | null>(null);
  const [meetingDay, setMeetingDay] = useState<string>("none");
  const [meetingTime, setMeetingTime] = useState("");
  const [locationText, setLocationText] = useState("");
  const [capacity, setCapacity] = useState("");
  const [description, setDescription] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<GroupDTO>("/groups", {
        name: name.trim(),
        type,
        leaderPersonId: hod?.id || undefined,
        meetingDay: meetingDay === "none" ? undefined : meetingDay,
        meetingTime: meetingTime || undefined,
        locationText: locationText.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
        description: description.trim() || undefined,
        isOpen,
      });
      toast.success(`Created ${res.name}`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto scroll-slim">
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
          <DialogDescription>Departments, classes, serve teams and ministries all live here.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="g-name">Name *</Label>
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <HodPicker value={hod} onChange={setHod} inputId="g-hod" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="g-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="g-type" aria-label="Group type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-capacity">Capacity</Label>
              <Input
                id="g-capacity" type="number" min={1} value={capacity}
                onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 12"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="g-day">Meeting day</Label>
              <Select value={meetingDay} onValueChange={setMeetingDay}>
                <SelectTrigger id="g-day" aria-label="Meeting day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No set day</SelectItem>
                  {MEETING_DAYS.map((d) => (
                    <SelectItem key={d} value={d}>{dayLabel(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-time">Meeting time</Label>
              <Input id="g-time" type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-loc">Location</Label>
            <Input id="g-loc" value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Home, room or address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Description</Label>
            <Textarea id="g-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="g-open" className="font-normal">Open to new members</Label>
              <p className="text-[11px] text-muted-foreground">Members can request to join from My Portal.</p>
            </div>
            <Switch id="g-open" checked={isOpen} onCheckedChange={setIsOpen} aria-label="Open to new members" />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create department"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit department dialog (full customization — groups.manage gated) ────────

function EditDepartmentDialog({ group, onClose }: { group: GroupDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(group.name);
  const [type, setType] = useState(group.type);
  const [hod, setHod] = useState<{ id: string; name: string } | null>(
    group.leaderPersonId ? { id: group.leaderPersonId, name: group.leaderName ?? "" } : null,
  );
  const [meetingDay, setMeetingDay] = useState(group.meetingDay ?? "none");
  const [meetingTime, setMeetingTime] = useState(group.meetingTime ?? "");
  const [locationText, setLocationText] = useState(group.locationText ?? "");
  const [capacity, setCapacity] = useState(group.capacity != null ? String(group.capacity) : "");
  const [description, setDescription] = useState(group.description ?? "");
  const [isOpen, setIsOpen] = useState(group.isOpen !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== group.name ||
    type !== group.type ||
    (hod?.id ?? null) !== (group.leaderPersonId ?? null) ||
    (meetingDay === "none" ? null : meetingDay) !== (group.meetingDay ?? null) ||
    (meetingTime || null) !== (group.meetingTime ?? null) ||
    (locationText.trim() || null) !== (group.locationText ?? null) ||
    (capacity ? Number(capacity) : null) !== (group.capacity ?? null) ||
    (description.trim() || null) !== (group.description ?? null) ||
    isOpen !== group.isOpen;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<GroupDTO>(`/groups/${group.id}`, {
        name: name.trim(),
        type,
        leaderPersonId: hod?.id ?? null,
        meetingDay: meetingDay === "none" ? null : meetingDay,
        meetingTime: meetingTime || null,
        locationText: locationText.trim() || null,
        capacity: capacity ? Number(capacity) : null,
        description: description.trim() || null,
        isOpen,
      });
      toast.success(`Saved ${res.name}`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto scroll-slim">
        <DialogHeader>
          <DialogTitle>Edit department</DialogTitle>
          <DialogDescription>
            Rename it, change the HOD, meeting pattern, capacity or joinability. Only people with department manage access can save changes.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="e-name">Name *</Label>
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <HodPicker value={hod} onChange={setHod} inputId="e-hod" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="e-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="e-type" aria-label="Department type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-capacity">Capacity</Label>
              <Input
                id="e-capacity" type="number" min={1} value={capacity}
                onChange={(e) => setCapacity(e.target.value)} placeholder="No limit"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="e-day">Meeting day</Label>
              <Select value={meetingDay} onValueChange={setMeetingDay}>
                <SelectTrigger id="e-day" aria-label="Meeting day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No set day</SelectItem>
                  {MEETING_DAYS.map((d) => (
                    <SelectItem key={d} value={d}>{dayLabel(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-time">Meeting time</Label>
              <Input id="e-time" type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-loc">Location</Label>
            <Input id="e-loc" value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Home, room or address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-desc">Description</Label>
            <Textarea id="e-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="e-open" className="font-normal">Open to new members</Label>
              <p className="text-[11px] text-muted-foreground">Members can request to join from My Portal.</p>
            </div>
            <Switch id="e-open" checked={isOpen} onCheckedChange={setIsOpen} aria-label="Open to new members" />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Add member picker ────────────────────────────────────────────────────────

function AddMemberDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const search = useDebounced(text, 250);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const peopleQ = useApiQuery<Paged<PersonListItem>>(
    ["people", "picker", search],
    `/people${qs({ search: search || undefined, pageSize: 20 })}`,
  );

  async function add(p: PersonListItem) {
    setBusyId(p.id);
    setError(null);
    try {
      await api.post(`/groups/${groupId}/members`, { personId: p.id });
      toast.success(`Added ${p.firstName} ${p.lastName}`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyId(null);
    }
  }

  const items = peopleQ.data?.items ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>Search the congregation, then click a person to add them to the department.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search name, email or phone…"
              className="pl-8"
              aria-label="Search people to add"
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <ul className="max-h-72 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="Search results">
            {peopleQ.isLoading ? (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">Searching…</li>
            ) : items.length === 0 ? (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                {search ? "No matches." : "Start typing to search."}
              </li>
            ) : (
              items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => void add(p)}
                    className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50"
                  >
                    <PersonAvatar name={`${p.firstName} ${p.lastName}`} className="h-7 w-7 text-[10px]" />
                    <span className="min-w-0 flex-1 truncate">{p.firstName} {p.lastName}</span>
                    <span className="max-w-36 truncate text-[11px] text-muted-foreground">{p.email ?? ""}</span>
                    {busyId === p.id ? <span className="text-[11px]">Adding…</span> : <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Remove member (per-row confirm) ──────────────────────────────────────────

function RemoveMemberButton({ groupId, member, groupName }: { groupId: string; member: GroupMember; groupName: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/groups/${groupId}/members/${member.personId}`);
      toast.success(`${member.name} removed from ${groupName}`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Remove ${member.name}`}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They will be marked as having left {groupName}. Their past attendance stays on record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void remove()} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Make HOD (one-click leader change on a roster row) ───────────────────

function MakeHodButton({ groupId, member, groupName }: { groupId: string; member: GroupMember; groupName: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function makeHod() {
    setBusy(true);
    try {
      await api.put(`/groups/${groupId}`, { leaderPersonId: member.personId });
      toast.success(`${member.name} is now the HOD of ${groupName}`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost" size="icon" disabled={busy}
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          aria-label={`Make ${member.name} the HOD of ${groupName}`}
        >
          <Crown className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Make {member.name} the HOD?</AlertDialogTitle>
          <AlertDialogDescription>
            They will lead {groupName} and appear on the roster as its leader. The previous HOD stays on the roster as a member.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void makeHod()} disabled={busy}>
            {busy ? "Saving…" : "Make HOD"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Department detail dialog ─────────────────────────────────────────────────

function GroupDetailDialog({ groupId, canManage, canAttend, onClose }: {
  groupId: string;
  canManage: boolean;
  canAttend: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detailQ = useApiQuery<GroupDetail>(["groups", "detail", groupId], `/groups/${groupId}`);
  const d = detailQ.data;

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [meetingId, setMeetingId] = useState("");
  const [records, setRecords] = useState<Record<string, AttendStatus>>({});
  const [newMeetingDate, setNewMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  // Latest meeting by default; quick-take defaults everyone to present.
  useEffect(() => {
    if (!d) return;
    const sorted = [...d.meetings].sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
    setMeetingId((cur) => cur || sorted[0]?.id || "");
    setRecords(Object.fromEntries(d.members.map((m) => [m.personId, "present" as AttendStatus])));
  }, [d]);

  async function decideRequest(requestId: string, action: "approve" | "decline", name: string) {
    setBusy(true);
    try {
      await api.post(`/groups/${groupId}/join-requests/${requestId}`, { action });
      toast.success(action === "approve" ? `${name} approved into the group` : `Declined ${name}'s request`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function createMeeting() {
    setBusy(true);
    try {
      const res = await api.post<{ eventId: string }>(`/groups/${groupId}/meetings`, { date: newMeetingDate });
      toast.success("Meeting created");
      setMeetingId(res.eventId);
      void qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveAttendance() {
    if (!d || !meetingId) return;
    setBusy(true);
    try {
      const payload = d.members.map((m) => ({ personId: m.personId, status: records[m.personId] ?? "present" }));
      const res = await api.post<{ saved: number }>(`/groups/${groupId}/attendance`, { eventId: meetingId, records: payload });
      toast.success(`Attendance saved for ${res.saved} ${res.saved === 1 ? "person" : "people"}`);
      void qc.invalidateQueries({ queryKey: ["groups"] });
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const meetings = [...(d?.meetings ?? [])].sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto scroll-slim">
        {detailQ.isLoading || !d ? (
          <>
            <DialogTitle className="sr-only">Department details</DialogTitle>
            <LoadingBlock label="Loading department…" />
          </>
        ) : detailQ.error ? (
          <>
            <DialogTitle className="sr-only">Department details</DialogTitle>
            <ErrorBlock error={detailQ.error} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-left">
                {d.group.name}
                <Badge variant="secondary" className="font-normal">{typeLabel(d.group.type)}</Badge>
                {d.group.isOpen === false ? (
                  <Badge variant="outline" className="font-normal text-muted-foreground">Closed to new</Badge>
                ) : null}
                {canManage ? (
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label={`Edit ${d.group.name}`}
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </DialogTitle>
              <DialogDescription className="text-left">
                {[
                  d.group.leaderName ? `HOD: ${d.group.leaderName}` : "No HOD assigned",
                  meetingPattern(d.group),
                  d.group.locationText ?? null,
                ].filter(Boolean).join("  ·  ")}
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="roster">
              <TabsList>
                <TabsTrigger value="roster">Roster ({d.members.length})</TabsTrigger>
                <TabsTrigger value="attendance">Attendance</TabsTrigger>
                <TabsTrigger value="absences">
                  Absences{d.absentees.length > 0 ? ` (${d.absentees.length})` : ""}
                </TabsTrigger>
              </TabsList>

              {/* ── Roster ── */}
              <TabsContent value="roster" className="space-y-4">
                {d.joinRequests.length > 0 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                      <UserPlus className="h-3.5 w-3.5" /> {d.joinRequests.length} pending join {d.joinRequests.length === 1 ? "request" : "requests"}
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {d.joinRequests.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md bg-background/70 px-2.5 py-2">
                          <PersonAvatar name={r.person.name} className="h-7 w-7 text-[10px]" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{r.person.name}</p>
                            {r.message ? <p className="truncate text-xs text-muted-foreground">“{r.message}”</p> : null}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
                          {canManage ? (
                            <span className="flex gap-1.5">
                              <Button size="sm" className="h-7" disabled={busy} onClick={() => void decideRequest(r.id, "approve", r.person.name)}>
                                <Check className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void decideRequest(r.id, "decline", r.person.name)}>
                                <X className="h-3.5 w-3.5" /> Decline
                              </Button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {d.members.length === 0 ? (
                  <EmptyState title="No members yet" description="Add people from the congregation to build the roster." />
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Joined</TableHead>
                          {canManage ? <TableHead className="w-10"><span className="sr-only">Remove</span></TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.members.map((m) => (
                          <TableRow key={m.personId}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <PersonAvatar name={m.name} />
                                <span className="text-sm font-medium">{m.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-52 space-y-0.5">
                                <p className="truncate text-xs">{m.email ?? <span className="text-muted-foreground">—</span>}</p>
                                <p className="truncate text-xs text-muted-foreground">{m.phone ?? ""}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[11px] capitalize">{roleLabel(m.role)}</Badge>
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{fmtDate(m.joinedAt)}</TableCell>
                            {canManage ? (
                              <TableCell>
                                <span className="flex items-center gap-0.5">
                                  {m.personId !== d.group.leaderPersonId ? (
                                    <MakeHodButton groupId={groupId} member={m} groupName={d.group.name} />
                                  ) : null}
                                  <RemoveMemberButton groupId={groupId} member={m} groupName={d.group.name} />
                                </span>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {canManage ? (
                  <Button type="button" variant="outline" onClick={() => setAddOpen(true)}>
                    <UserPlus className="h-4 w-4" /> Add member
                  </Button>
                ) : null}
              </TabsContent>

              {/* ── Attendance ── */}
              <TabsContent value="attendance" className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-56 flex-1 space-y-1.5">
                    <Label htmlFor="meeting-pick">Meeting</Label>
                    <Select value={meetingId} onValueChange={setMeetingId} disabled={meetings.length === 0}>
                      <SelectTrigger id="meeting-pick" aria-label="Select meeting">
                        <SelectValue placeholder={meetings.length === 0 ? "No meetings yet" : "Pick a meeting…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {meetings.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {fmtDateTime(m.startsAt)} · {m.presentCount ?? 0} present
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {canAttend && d.members.length > 0 ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setRecords(Object.fromEntries(d.members.map((m) => [m.personId, "present" as AttendStatus])))}
                      >
                        <Check className="h-4 w-4" /> Mark all present
                      </Button>
                      <Button type="button" disabled={!meetingId || busy} onClick={() => void saveAttendance()}>
                        {busy ? "Saving…" : "Save attendance"}
                      </Button>
                    </>
                  ) : null}
                </div>

                {meetings.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4">
                    <p className="text-sm text-muted-foreground">
                      No meetings on record yet. Create one to start taking attendance.
                    </p>
                    {canAttend ? (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="new-meeting-date">Meeting date</Label>
                          <Input
                            id="new-meeting-date" type="date" value={newMeetingDate}
                            onChange={(e) => setNewMeetingDate(e.target.value)} className="w-44"
                          />
                        </div>
                        <Button type="button" variant="outline" disabled={busy || !newMeetingDate} onClick={() => void createMeeting()}>
                          <CalendarPlus className="h-4 w-4" /> Create meeting
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : d.members.length === 0 ? (
                  <EmptyState title="No members to record" description="Add members to the roster first." />
                ) : (
                  <ul className="max-h-96 space-y-1.5 overflow-y-auto scroll-slim pr-1" aria-label="Attendance quick take">
                    {d.members.map((m) => (
                      <li key={m.personId} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2">
                        <PersonAvatar name={m.name} className="h-8 w-8 text-[11px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.name}</p>
                          {m.email ? <p className="truncate text-[11px] text-muted-foreground">{m.email}</p> : null}
                        </div>
                        <RadioGroup
                          dir="ltr"
                          className="flex flex-row items-center gap-4"
                          value={records[m.personId] ?? "present"}
                          onValueChange={(v) => setRecords((r) => ({ ...r, [m.personId]: v as AttendStatus }))}
                          disabled={!canAttend}
                        >
                          {([
                            { value: "present", label: "Present" },
                            { value: "absent", label: "Absent" },
                            { value: "late", label: "Late" },
                          ] as const).map((opt) => (
                            <span key={opt.value} className="flex items-center gap-1.5">
                              <RadioGroupItem
                                value={opt.value}
                                id={`att-${m.personId}-${opt.value}`}
                                aria-label={`${m.name} — ${opt.label}`}
                              />
                              <Label
                                htmlFor={`att-${m.personId}-${opt.value}`}
                                className="cursor-pointer text-xs font-normal"
                                onClick={() => canAttend && setRecords((r) => ({ ...r, [m.personId]: opt.value }))}
                              >
                                {opt.label}
                              </Label>
                            </span>
                          ))}
                        </RadioGroup>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              {/* ── Absences ── */}
              <TabsContent value="absences">
                {d.absentees.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No chronic absentees"
                    description="Everyone active in this group has been showing up. Nice."
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {d.absentees.map((a) => (
                      <li key={a.personId} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
                        <PersonAvatar name={a.name} className="h-8 w-8 text-[11px]" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-transparent font-medium",
                            a.weeksAbsent >= 3
                              ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                          )}
                        >
                          {a.weeksAbsent} {a.weeksAbsent === 1 ? "week" : "weeks"} absent
                        </Badge>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          Last seen {fmtDate(a.lastSeen)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>

            <p className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Average attendance {Math.round(d.attendanceRate)}% over the last 6 meetings.
            </p>
          </>
        )}

        {addOpen ? <AddMemberDialog groupId={groupId} onClose={() => setAddOpen(false)} /> : null}
        {editOpen && d ? <EditDepartmentDialog group={d.group} onClose={() => setEditOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// ── Module ───────────────────────────────────────────────────────────────────

export default function GroupsModule({ user }: ModuleProps) {
  const canManage = user.permissions.includes("groups.manage");

  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText);
  const [type, setType] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const groupsQ = useApiQuery<{ items: GroupListItem[] }>(
    ["groups", "list", { search, type }],
    `/groups${qs({ search: search || undefined, type: type === "all" ? undefined : type })}`,
  );

  const items = groupsQ.data?.items ?? [];

  function openGroup(g: GroupListItem) {
    setSelectedId(g.id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Departments, classes, serve teams and ministries — rosters, attendance and care."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> New department
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search departments…"
            className="pl-8"
            aria-label="Search departments"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {GROUP_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm tabular-nums text-muted-foreground">
          {groupsQ.data ? `${items.length} ${items.length === 1 ? "department" : "departments"}` : "…"}
        </span>
      </div>

      {groupsQ.isLoading ? (
        <LoadingBlock label="Loading departments…" />
      ) : groupsQ.error ? (
        <ErrorBlock error={groupsQ.error} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No departments match"
          description={search ? `Nothing found for “${search}”.` : "Create your first department to get started."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((g) => {
            const fill = g.capacity && g.capacity > 0 ? Math.min(100, Math.round((g.memberCount / g.capacity) * 100)) : null;
            return (
              <Card
                key={g.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${g.name}`}
                onClick={() => openGroup(g)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openGroup(g);
                  }
                }}
                className="row-hover cursor-pointer py-4 transition-colors hover:border-primary/40"
              >
                <CardContent className="space-y-2.5 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 text-sm font-semibold leading-snug">{g.name}</h3>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] font-normal">{typeLabel(g.type)}</Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                    </div>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3 w-3 shrink-0" aria-hidden />
                    {g.leaderName ? `HOD: ${g.leaderName}` : "No HOD assigned"}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" aria-hidden />
                    {meetingPattern(g)}
                  </p>
                  {g.locationText ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{g.locationText}</span>
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {g.memberCount}{g.capacity ? ` of ${g.capacity}` : ""} members
                    </span>
                    {g.attendanceRate != null ? (
                      <span className={cn("tabular-nums", g.attendanceRate < 60 ? "text-amber-700 dark:text-amber-400" : "text-teal-700 dark:text-teal-400")}>
                        {Math.round(g.attendanceRate)}% attendance
                      </span>
                    ) : null}
                  </div>
                  {g.attendanceRate != null ? (
                    <Progress value={Math.min(100, g.attendanceRate)} aria-label={`${Math.round(g.attendanceRate)}% attendance`} />
                  ) : fill != null ? (
                    <Progress value={fill} aria-label={`${fill}% full`} />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {newOpen ? <NewGroupDialog onClose={() => setNewOpen(false)} /> : null}
      {selectedId ? (
        <GroupDetailDialog
          groupId={selectedId}
          canManage={canManage}
          canAttend={user.permissions.includes("groups.attendance")}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}
