"use client";

/**
 * People CRM v4 (Phase 4) — Profile 360: full page + peek drawer, ONE set of
 * components. The full page replaces the CRM workspace (deep-linkable via
 * `#/people/:id`); the peek drawer shows the very same header + tabs in a
 * Sheet. All data comes from the scoped GET /people/v2/:id/profile response —
 * the server omits fields the viewer cannot see, so the UI never has to hide
 * anything itself.
 *
 * Quick actions: Call / WhatsApp / Email (only when the contact exists),
 * Add note (staff), Add to group (people.groups.manage). Editing writes
 * through the EXISTING PUT /people/:id contract.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, BadgeCheck, Briefcase, Cake, ChevronRight,
  Mail, MapPin, MessageCircle, Pencil, Phone, StickyNote, Users,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ErrorBlock, LoadingBlock, PersonAvatar, StatusBadge, StageBadge, useApiQuery,
} from "@/components/app/shared";
import { api, ApiError, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ageOf, fmtDate } from "@/lib/types";
import { AvatarUpload } from "@/components/app/modules/people/AvatarUpload";
import { TagPicker } from "@/components/app/modules/people/TagPicker";
import { NigerianStateLgaSelect } from "@/components/app/signup/NigerianStateLgaSelect";
import {
  ProfileOverview, ProfileFamily, ProfileJourney,
  ProfileAttendance, ProfileGiving, ProfileNotes, ProfileCommunication, ProfileActivity,
  NoteDialog,
} from "./crm-profile-tabs";
import { waLink, type PersonProfile } from "./crm-shared";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

// ── data ─────────────────────────────────────────────────────────────────────

export function invalidatePersonProfile(qc: ReturnType<typeof useQueryClient>, personId: string) {
  void qc.invalidateQueries({ queryKey: ["people", "v2", "profile"] });
  void qc.invalidateQueries({ queryKey: ["people"] });
  void qc.invalidateQueries({ queryKey: ["households"] });
  // Phase 5 profile datasets
  void qc.invalidateQueries({ queryKey: ["people", "v2", "notes"] });
  void qc.invalidateQueries({ queryKey: ["people", "v2", "attendance"] });
  void qc.invalidateQueries({ queryKey: ["people", "v2", "messages"] });
  void qc.invalidateQueries({ queryKey: ["people", "v2", "activity"] });
}

export function usePersonProfile(personId: string | null | undefined, enabled = true) {
  return useApiQuery<PersonProfile>(
    ["people", "v2", "profile", personId ?? ""],
    `/people/v2/${personId}/profile`,
    { enabled: Boolean(personId) && enabled },
  );
}

export function profileDisplayName(p: PersonProfile["person"]): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

// ── quick action buttons ─────────────────────────────────────────────────────

function QuickAction({ icon: Icon, label, href, onClick, tone }: {
  icon: React.ElementType;
  label: string;
  href?: string;
  onClick?: () => void;
  tone?: "default" | "whatsapp";
}) {
  const cls = cn(
    "h-8 gap-1.5 rounded-full px-3 text-xs",
    tone === "whatsapp" ? "border-teal-600/40 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/40" : ""
  );
  if (href) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cn("inline-flex items-center whitespace-nowrap border bg-background font-medium transition-colors hover:bg-muted", cls)}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{label}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" className={cls} onClick={onClick}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span>{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const GROUP_ROLES = ["member", "leader", "apprentice"] as const;

/** Self-contained "Add to group" quick action (search → role → add). */
function QuickAddToGroup({ personId, onChanged }: { personId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<{ groupId: string; groupName: string; role: string } | null>(null);
  const [leaderConfirm, setLeaderConfirm] = useState<{ groupId: string; groupName: string; role: string } | null>(null);

  const groupsQ = useApiQuery<{ items: { id: string; name: string; type: string; memberCount: number; status: string }[] }>(
    ["groups", "search", { q: searchText, quickAdd: true }],
    `/groups${qs({ search: searchText || undefined, pageSize: 50 })}`,
    { enabled: open },
  );
  const available = (groupsQ.data?.items ?? []).filter((g) => g.status === "active");

  async function addToGroup() {
    if (!expanded) return;
    setBusy(true);
    try {
      await api.post(`/people/${personId}/groups`, { groupId: expanded.groupId, role: expanded.role });
      toast.success(`Added to ${expanded.groupName}`);
      setExpanded(null);
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setSearchText("");
            setExpanded(null);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="h-8 gap-1.5 rounded-full px-3 text-xs">
                <Users className="h-3.5 w-3.5" aria-hidden />
                <span>Add to group</span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Add to group</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-64 space-y-2 p-2">
          <div className="flex items-center gap-2">
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search groups…"
              className="h-8"
              aria-label="Search groups"
            />
          </div>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="Group results">
            {groupsQ.isLoading ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</li>
            ) : available.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                {searchText.trim() ? "No matches." : "No active groups found."}
              </li>
            ) : (
              available.map((g) => {
                const isExpanded = expanded?.groupId === g.id;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : { groupId: g.id, groupName: g.name, role: "member" })}
                      aria-pressed={isExpanded}
                      className={cn(
                        "row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        isExpanded && "bg-primary/15",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{g.memberCount}</span>
                    </button>
                    {isExpanded ? (
                      <div className="mb-1 mt-1.5 flex items-center gap-2 px-1">
                        <Select
                          value={expanded.role}
                          onValueChange={(v) => setExpanded({ ...expanded, role: v })}
                        >
                          <SelectTrigger className="h-8 w-32" aria-label={`Role in ${g.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GROUP_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={busy}
                          onClick={() =>
                            expanded.role === "leader"
                              ? setLeaderConfirm({ groupId: expanded.groupId, groupName: expanded.groupName, role: expanded.role })
                              : void addToGroup()
                          }
                        >
                          Add
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </PopoverContent>
      </Popover>

      <AlertDialog open={leaderConfirm !== null} onOpenChange={(o) => !o && setLeaderConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give leader access?</AlertDialogTitle>
            <AlertDialogDescription>
              Leaders can see the group roster and take attendance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLeaderConfirm(null);
                void addToGroup();
              }}
            >
              Make leader
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Add note dialog (staff) ──────────────────────────────────────────────────

// ── Edit dialog (writes through the EXISTING PUT /people/:id contract) ──────

const TITLE_OPTIONS = ["Mr", "Mrs", "Miss", "Dr", "Pastor", "Rev", "Chief", "Alhaji", "Alhaja"];
const MARITAL_OPTIONS = ["single", "engaged", "married", "widowed", "divorced", "separated"];
const CHANNEL_OPTIONS = ["sms", "email", "whatsapp", "call", "any"];

function ProfileEditDialog({ profile, onClose, onDone }: {
  profile: PersonProfile;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const p = profile.person;
  const [form, setForm] = useState({
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    whatsapp: p.whatsappE164 ?? "",
    birthdate: p.birthdate ? p.birthdate.slice(0, 10) : "",
    gender: p.gender ?? "",
    title: p.title ?? "",
    maritalStatus: p.maritalStatus ?? "",
    weddingAnniversary: p.weddingAnniversary ? p.weddingAnniversary.slice(0, 10) : "",
    occupation: p.occupation ?? "",
    employer: p.employer ?? "",
    preferredChannel: p.preferredChannel ?? "",
    state: p.state ?? "",
    lga: p.lga ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/people/${p.id}`, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        preferredName: form.preferredName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        whatsapp: form.whatsapp.trim() || undefined,
        birthdate: form.birthdate || undefined,
        gender: form.gender || undefined,
        title: form.title || undefined,
        maritalStatus: form.maritalStatus || undefined,
        weddingAnniversary: form.weddingAnniversary || undefined,
        occupation: form.occupation.trim() || undefined,
        employer: form.employer.trim() || undefined,
        preferredChannel: form.preferredChannel || undefined,
        state: form.state || undefined,
        lga: form.lga || undefined,
      });
      toast.success("Profile updated");
      onDone();
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
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Changes save through the same record editor the classic view uses.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pe-first">First name *</Label>
              <Input id="pe-first" value={form.firstName} onChange={(e) => set("firstName")(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-last">Last name *</Label>
              <Input id="pe-last" value={form.lastName} onChange={(e) => set("lastName")(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pe-pref">Preferred name</Label>
              <Input id="pe-pref" value={form.preferredName} onChange={(e) => set("preferredName")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-title">Title</Label>
              <Select value={form.title || undefined} onValueChange={set("title")}>
                <SelectTrigger id="pe-title" aria-label="Title"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="—">—</SelectItem>
                  {TITLE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pe-email">Email</Label>
              <Input id="pe-email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-phone">Phone</Label>
              <Input id="pe-phone" type="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-wa">WhatsApp</Label>
              <Input id="pe-wa" type="tel" value={form.whatsapp} onChange={(e) => set("whatsapp")(e.target.value)} placeholder="+234…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-channel">Preferred channel</Label>
              <Select value={form.preferredChannel || undefined} onValueChange={set("preferredChannel")}>
                <SelectTrigger id="pe-channel" aria-label="Preferred channel"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="—">—</SelectItem>
                  {CHANNEL_OPTIONS.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pe-birth">Birthdate</Label>
              <Input id="pe-birth" type="date" value={form.birthdate} onChange={(e) => set("birthdate")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-gender">Gender</Label>
              <Select value={form.gender || undefined} onValueChange={set("gender")}>
                <SelectTrigger id="pe-gender" aria-label="Gender"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="—">—</SelectItem>
                  <SelectItem value="m">Male</SelectItem>
                  <SelectItem value="f">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pe-marital">Marital status</Label>
              <Select value={form.maritalStatus || undefined} onValueChange={set("maritalStatus")}>
                <SelectTrigger id="pe-marital" aria-label="Marital status"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="—">—</SelectItem>
                  {MARITAL_OPTIONS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-anniv">Wedding anniversary</Label>
              <Input id="pe-anniv" type="date" value={form.weddingAnniversary} onChange={(e) => set("weddingAnniversary")(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pe-occ">Occupation</Label>
              <Input id="pe-occ" value={form.occupation} onChange={(e) => set("occupation")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe-emp">Employer</Label>
              <Input id="pe-emp" value={form.employer} onChange={(e) => set("employer")(e.target.value)} />
            </div>
          </div>
          <NigerianStateLgaSelect
            idPrefix="pe-addr"
            state={form.state}
            lga={form.lga}
            onState={set("state")}
            onLga={set("lga")}
          />
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── shared permissions bundle ────────────────────────────────────────────────

export interface ProfilePerms {
  /** people.edit — gates staff quick actions (Add note) + Journey editing UI. */
  canEditPeople: boolean;
  /** people.tags.manage — TagPicker add/remove. */
  canTags: boolean;
  /** people.groups.manage — Add-to-group quick action. */
  canGroups: boolean;
  /** Phase 6 — open the full add/edit slide-over for this person (the parent
   *  owns the sheet; without it the header falls back to the small dialog). */
  onEditPerson?: (personId: string) => void;
}

// ── the profile header (used by BOTH the page and the drawer) ────────────────

export function ProfileHeader({ profile, perms, onChanged, compact }: {
  profile: PersonProfile;
  perms: ProfilePerms;
  onChanged: () => void;
  compact?: boolean;
}) {
  const p = profile.person;
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const name = profileDisplayName(p);

  const phoneHref = p.phoneE164 ?? p.phone ?? null;
  const wa = waLink(p.whatsappE164 ?? p.phoneE164 ?? null);
  const age = p.birthdate ? ageOf(p.birthdate) : null;
  const memberSince = p.membershipDate ? fmtDate(p.membershipDate) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <header className={cn("space-y-3", compact ? "" : "border-b pb-5")}>
        <div className="flex items-start gap-4">
          <AvatarUpload
            personId={p.id}
            name={name}
            photoUrl={p.photoUrl}
            canEdit={p.canEdit}
            className={compact ? "h-14 w-14 text-base" : "h-20 w-20 text-xl"}
            onChanged={onChanged}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={cn("truncate font-semibold leading-tight", compact ? "text-base" : "text-xl")}>
                {p.title ? <span className="font-normal text-muted-foreground">{p.title} </span> : null}
                {name}
              </h1>
              <StageBadge stage={p.lifecycleStage} />
              {p.status === "archived" ? <StatusBadge status="archived" /> : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {p.campusName ? (
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {p.campusName}</span>
              ) : null}
              {memberSince ? (
                <span className="inline-flex items-center gap-1"><BadgeCheck className="h-3 w-3" aria-hidden /> Member since {memberSince}</span>
              ) : null}
              {age != null && p.birthdateYearKnown !== false ? (
                <span className="inline-flex items-center gap-1"><Cake className="h-3 w-3" aria-hidden /> {age} yrs</span>
              ) : null}
              {p.occupation ? (
                <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" aria-hidden /> {p.occupation}</span>
              ) : null}
            </p>
            <div className="mt-2">
              <TagPicker personId={p.id} tags={profile.tags} canManage={perms.canTags} onChanged={onChanged} />
            </div>
          </div>
          {p.canEdit ? (
            <Button
              type="button"
              size={compact ? "sm" : "default"}
              variant="outline"
              className={cn("shrink-0", compact && "mr-6")}
              onClick={() => (perms.onEditPerson ? perms.onEditPerson(p.id) : setEditOpen(true))}
            >
              <Pencil className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} /> Edit
            </Button>
          ) : null}
        </div>

        {/* Quick actions — shown only when permitted AND the contact exists */}
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Quick actions">
          {phoneHref ? <QuickAction icon={Phone} label="Call" href={`tel:${phoneHref}`} /> : null}
          {wa ? <QuickAction icon={MessageCircle} label="WhatsApp" href={wa} tone="whatsapp" /> : null}
          {p.email ? <QuickAction icon={Mail} label="Email" href={`mailto:${p.email}`} /> : null}
          {perms.canEditPeople ? (
            <QuickAction icon={StickyNote} label="Add note" onClick={() => setNoteOpen(true)} />
          ) : null}
          {perms.canGroups ? <QuickAddToGroup personId={p.id} onChanged={onChanged} /> : null}
        </div>

        {editOpen ? (
          /* Fallback when no Phase 6 sheet is wired — the small dialog still
             writes through the same PUT /people/:id contract. */
          <ProfileEditDialog
            profile={profile}
            onClose={() => setEditOpen(false)}
            onDone={() => onChanged()}
          />
        ) : null}
        {noteOpen ? (
          <NoteDialog
            open={noteOpen}
            personId={p.id}
            personName={p.firstName}
            canConfidential={profile.tabs?.notesConfidential === true}
            onClose={() => setNoteOpen(false)}
            onDone={onChanged}
          />
        ) : null}
      </header>
    </TooltipProvider>
  );
}

// ── the shared tabbed body (page + drawer) ───────────────────────────────────

function ProfileBody({ profile, perms, onChanged, onOpenPerson }: {
  profile: PersonProfile;
  perms: ProfilePerms;
  onChanged: () => void;
  onOpenPerson?: (personId: string) => void;
}) {
  // local tab state — parents mount a fresh body per person (via key), so no
  // reset effect is needed. Tab visibility comes from the server-computed
  // `tabs` flags (UI hides only — every sub-endpoint enforces the same rule);
  // a missing flags object (legacy cache) falls back to the Phase 4 three.
  const [tab, setTab] = useState("overview");
  const tabs = profile.tabs;
  return (
    <Tabs value={tab} onValueChange={setTab} className="min-h-0">
      <div className="max-w-full overflow-x-auto">
        <TabsList aria-label="Profile sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="family">Family</TabsTrigger>
          <TabsTrigger value="journey">Journey</TabsTrigger>
          {tabs?.attendance ? <TabsTrigger value="attendance">Attendance</TabsTrigger> : null}
          {tabs?.giving ? <TabsTrigger value="giving">Giving</TabsTrigger> : null}
          {tabs?.notes ? <TabsTrigger value="notes">Notes</TabsTrigger> : null}
          {tabs?.comms ? <TabsTrigger value="comms">Messages</TabsTrigger> : null}
          {tabs?.activity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
        </TabsList>
      </div>
      <TabsContent value="overview" className="mt-4 outline-none">
        <ProfileOverview
          profile={profile}
          onChanged={onChanged}
          onOpenPerson={onOpenPerson}
          canGroups={perms.canGroups}
          canTags={perms.canTags}
        />
      </TabsContent>
      <TabsContent value="family" className="mt-4 outline-none">
        <ProfileFamily profile={profile} onChanged={onChanged} onOpenPerson={onOpenPerson} />
      </TabsContent>
      <TabsContent value="journey" className="mt-4 outline-none">
        <ProfileJourney
          profile={profile}
          onChanged={onChanged}
          canEditPeople={perms.canEditPeople}
        />
      </TabsContent>
      {tabs?.attendance ? (
        <TabsContent value="attendance" className="mt-4 outline-none">
          <ProfileAttendance profile={profile} />
        </TabsContent>
      ) : null}
      {tabs?.giving ? (
        <TabsContent value="giving" className="mt-4 outline-none">
          <ProfileGiving profile={profile} />
        </TabsContent>
      ) : null}
      {tabs?.notes ? (
        <TabsContent value="notes" className="mt-4 outline-none">
          <ProfileNotes profile={profile} onChanged={onChanged} />
        </TabsContent>
      ) : null}
      {tabs?.comms ? (
        <TabsContent value="comms" className="mt-4 outline-none">
          <ProfileCommunication profile={profile} />
        </TabsContent>
      ) : null}
      {tabs?.activity ? (
        <TabsContent value="activity" className="mt-4 outline-none">
          <ProfileActivity profile={profile} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

// ── full profile page (deep-linkable via #/people/:id) ───────────────────────

export function PersonProfilePage({ personId, onBack, perms, onOpenPerson }: {
  personId: string;
  onBack: () => void;
  perms: ProfilePerms;
  onOpenPerson: (personId: string) => void;
}) {
  const { data: profile, isLoading, error, refetch } = usePersonProfile(personId);

  return (
    <div className="space-y-5">
      <div>
        <Button type="button" variant="ghost" className="-ml-2 gap-1.5 text-muted-foreground" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to People
        </Button>
        <p className="sr-only">Profile page for person {personId}</p>
      </div>

      {isLoading || !profile ? (
        <div className="rounded-xl border bg-card">
          {error ? <ErrorBlock error={error} /> : <LoadingBlock label="Loading profile…" />}
        </div>
      ) : (
        <>
          <ProfileHeader profile={profile} perms={perms} onChanged={() => void refetch()} />
          <ProfileBody
            key={personId}
            profile={profile}
            perms={perms}
            onChanged={() => void refetch()}
            onOpenPerson={onOpenPerson}
          />
        </>
      )}
    </div>
  );
}

// ── peek drawer (same components, compact) ───────────────────────────────────

export function PersonPeekDrawer({ personId, onClose, onOpenFull, perms, rowName, rowPhoto }: {
  personId: string | null;
  onClose: () => void;
  onOpenFull: (personId: string) => void;
  perms: ProfilePerms;
  /** optimistic header info from the list row while the profile loads */
  rowName?: string | null;
  rowPhoto?: string | null;
}) {
  const open = personId !== null;
  const { data: profile, isLoading, error, refetch } = usePersonProfile(personId, open);

  const name = profile ? profileDisplayName(profile.person) : rowName ?? "";
  const photo = profile ? profile.person.photoUrl : rowPhoto ?? null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl scroll-slim">
        {open ? (
          <>
            {/* accessible dialog name — the visible header is ProfileHeader */}
            <SheetHeader className="sr-only">
              <SheetTitle>{isLoading && !profile ? "Loading profile…" : name}</SheetTitle>
              <SheetDescription>Profile quick view</SheetDescription>
            </SheetHeader>

            {error ? (
              <div className="p-5">
                <ErrorBlock error={error} />
              </div>
            ) : isLoading || !profile ? (
              <div className="flex items-center gap-3 border-b p-5">
                <PersonAvatar name={name} src={photo} className="h-11 w-11 text-sm shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{name}</p>
                  <p className="text-xs text-muted-foreground">Loading profile…</p>
                </div>
              </div>
            ) : (
              <>
                {/* SAME header component as the full page — photo, stage, tags,
                    meta line, Edit, and the full quick-actions row */}
                <div className="border-b p-5">
                  <ProfileHeader profile={profile} perms={perms} compact onChanged={() => void refetch()} />
                </div>

                <div className="flex-1 p-5">
                  <ProfileBody
                    profile={profile}
                    perms={perms}
                    onChanged={() => void refetch()}
                    onOpenPerson={(id) => {
                      // swap the drawer to the other person in place
                      onOpenFull(id);
                      onClose();
                    }}
                  />
                </div>

                <div className="sticky bottom-0 border-t bg-background/95 p-4 backdrop-blur">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      onOpenFull(profile.person.id);
                      onClose();
                    }}
                  >
                    Open full profile <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
