"use client";

/**
 * People CRM v4 (Phase 4) — Profile 360 tab contents: Overview · Family · Journey.
 * The SAME components render inside the full profile page AND the peek
 * drawer. Everything displayed comes straight from the scoped
 * GET /people/v2/:id/profile response — gated fields never arrive, so the
 * UI simply has nothing to render for viewers who may not see them.
 *
 * EXTENDS, never replaces: family editing reuses the existing
 * Household/Guardian endpoints + dialogs; group/tag editing reuses
 * GroupPicker/TagPicker; the Edit dialog writes through the existing
 * PUT /people/:id contract.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, BadgeCheck, Briefcase, Cake, CalendarDays, CalendarHeart, CheckCircle2,
  FileText, GraduationCap, HandHeart, Heart, Home, Link2, Mail, MapPin, MessageCircle,
  Phone, Plus, Send, ShieldCheck, Sparkles, Trash2, UserPlus, Users, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar, StageBadge } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, HOUSEHOLD_ROLES, HOUSEHOLD_ROLE_LABELS, STAGE_LABELS } from "@/lib/types";
import { GroupPicker } from "@/components/app/modules/people/GroupPicker";
import AddHouseholdMemberDialog from "@/components/app/modules/people/AddHouseholdMemberDialog";
import EditHouseholdDialog from "@/components/app/modules/people/EditHouseholdDialog";
import LinkGuardianDialog from "@/components/app/modules/people/LinkGuardianDialog";
import LinkDependentDialog from "@/components/app/modules/people/LinkDependentDialog";
import { waLink, milestoneLabel, sourceLabel, MILESTONE_TYPES, type PersonProfile } from "./crm-shared";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

// ── small building blocks ────────────────────────────────────────────────────

export function ProfileFact({ icon: Icon, label, children, className }: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="min-w-0 text-sm">{children}</div>
      </div>
    </div>
  );
}

export function ProfileSection({ icon: Icon, title, action, children, className }: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", className)} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function PersonLink({ personId, name, photoUrl, onOpenPerson, child, className }: {
  personId: string;
  name: string;
  photoUrl: string | null;
  onOpenPerson?: (personId: string) => void;
  child?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn("flex min-w-0 items-center gap-2 rounded text-left transition-colors hover:underline", className)}
      onClick={() => onOpenPerson?.(personId)}
      aria-label={`Open ${name}`}
    >
      <PersonAvatar name={name} src={photoUrl} child={child} className="h-7 w-7 text-[9px]" />
      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
    </button>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

const NEXT_STEP_ICON: Record<string, React.ElementType> = {
  collect_contact: Phone,
  follow_up_visit: MessageCircle,
  absent_4w: CalendarDays,
  birthday_soon: Cake,
  no_group: Users,
  salvation: HandHeart,
  water_baptism: Sparkles,
  workers_training: GraduationCap,
  assign_shepherd: BadgeCheck,
};

export function NextStepCard({ step, className }: { step: NonNullable<PersonProfile["nextStep"]>; className?: string }) {
  const Icon = NEXT_STEP_ICON[step.id] ?? Sparkles;
  return (
    <section
      className={cn("flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4", className)}
      aria-label="Suggested next step"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15" aria-hidden>
        <Icon className="h-4 w-4 text-primary" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Suggested next step</p>
        <p className="text-sm font-semibold">{step.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{step.reason}</p>
      </div>
    </section>
  );
}

export function ProfileOverview({ profile, onChanged, onOpenPerson, canGroups, canTags }: {
  profile: PersonProfile;
  onChanged: () => void;
  onOpenPerson?: (personId: string) => void;
  canGroups: boolean;
  canTags: boolean;
}) {
  const p = profile.person;
  const has = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  const wa = waLink(p.whatsappE164 ?? p.phoneE164 ?? null);
  const contactHidden = (k: string) => p.privacyHidden.includes(k);

  return (
    <div className="space-y-4">
      {profile.nextStep ? <NextStepCard step={profile.nextStep} /> : null}

      {/* Contact */}
      <ProfileSection icon={Phone} title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <ProfileFact icon={Phone} label="Phone">
            {has(p.phoneDisplay) ? (
              <a href={`tel:${p.phoneE164 ?? p.phone}`} className="hover:underline">{p.phoneDisplay}</a>
            ) : contactHidden("phone") ? (
              <span className="text-xs text-muted-foreground">Hidden by privacy settings</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </ProfileFact>
          <ProfileFact icon={MessageCircle} label="WhatsApp">
            {wa ? (
              <a href={wa} target="_blank" rel="noreferrer" className="hover:underline">Chat on WhatsApp</a>
            ) : contactHidden("phone") ? (
              <span className="text-xs text-muted-foreground">Hidden by privacy settings</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </ProfileFact>
          <ProfileFact icon={Mail} label="Email">
            {has(p.email) ? (
              <a href={`mailto:${p.email}`} className="block truncate hover:underline">{p.email}</a>
            ) : contactHidden("email") ? (
              <span className="text-xs text-muted-foreground">Hidden by privacy settings</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </ProfileFact>
          <ProfileFact icon={Send} label="Preferred channel">
            {has(p.preferredChannel) ? <span className="capitalize">{p.preferredChannel}</span> : <span className="text-muted-foreground">—</span>}
          </ProfileFact>
        </div>
        {/* directory privacy opt-ins — visible to the person, their family editor, staff */}
        {p.directoryPrivacy ? (
          <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
            Directory opt-ins:{" "}
            {(["phone", "email", "birthday", "address"] as const).map((k) => (
              <Badge key={k} variant={p.directoryPrivacy?.[k] ? "secondary" : "outline"} className="mr-1 text-[10px] capitalize">
                {p.directoryPrivacy?.[k] ? "✓" : "✕"} {k}
              </Badge>
            ))}
          </p>
        ) : null}
      </ProfileSection>

      {/* Address */}
      {(has(p.state) || has(p.lga) || (profile.household && (profile.household.addressLine1 || profile.household.city))) ? (
        <ProfileSection icon={MapPin} title="Address">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileFact icon={MapPin} label="State / LGA">
              {has(p.state) || has(p.lga)
                ? [p.lga, p.state].filter(Boolean).join(", ")
                : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            {profile.household ? (
              <ProfileFact icon={Home} label="Household address">
                {[profile.household.addressLine1, profile.household.addressLine2, profile.household.city, profile.household.region]
                  .filter(Boolean).join(", ") || <span className="text-muted-foreground">—</span>}
              </ProfileFact>
            ) : null}
          </div>
        </ProfileSection>
      ) : null}

      {/* Key dates + about */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileSection icon={CalendarDays} title="Key dates">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileFact icon={Cake} label="Birthday">
              {has(p.birthdate)
                ? `${fmtDate(p.birthdate)} · ${labelAge(p.birthdate)}`
                : contactHidden("birthday")
                  ? <span className="text-xs text-muted-foreground">Hidden by privacy settings</span>
                  : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={CalendarHeart} label="Wedding anniversary">
              {has(p.weddingAnniversary) ? fmtDate(p.weddingAnniversary) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={BadgeCheck} label="Member since">
              {has(p.membershipDate) ? fmtDate(p.membershipDate) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={CalendarDays} label="First visit">
              {has(p.firstVisitAt) ? fmtDate(p.firstVisitAt) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
          </div>
        </ProfileSection>

        <ProfileSection icon={Briefcase} title="Work & family status">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileFact icon={Briefcase} label="Occupation">
              {has(p.occupation) ? p.occupation : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={Briefcase} label="Employer">
              {has(p.employer) ? p.employer : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={Users} label="Marital status">
              {has(p.maritalStatus) ? <span className="capitalize">{p.maritalStatus}</span> : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={UserPlus} label="Gender">
              {has(p.gender) ? (p.gender === "m" ? "Male" : p.gender === "f" ? "Female" : p.gender) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
          </div>
        </ProfileSection>
      </div>

      {/* Emergency contacts — only rendered when the scoped response includes them */}
      {profile.emergencyContacts ? (
        <ProfileSection icon={AlertTriangle} title="Emergency contacts">
          {profile.emergencyContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {profile.emergencyContacts.map((c) => (
                <li key={c.personId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.relationshipType ? <Badge variant="secondary" className="text-[10px] capitalize">{c.relationshipType}</Badge> : null}
                  {c.phone ? <a href={`tel:${c.phone}`} className="text-muted-foreground hover:underline">{c.phone}</a> : null}
                </li>
              ))}
            </ul>
          )}
        </ProfileSection>
      ) : null}

      {/* Provenance + pastoral coverage — hidden wholesale when every field
          in it was omitted for this viewer tier */}
      {(has(p.source) || p.invitedBy || p.assignedShepherd || has(p.campusName) || has(p.preferredChannel)) ? (
        <ProfileSection icon={Link2} title="How they connect">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileFact icon={Link2} label="Source">
              {has(p.source) ? sourceLabel(p.source) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={UserPlus} label="Invited by">
              {p.invitedBy ? (
                <PersonLink personId={p.invitedBy.id} name={p.invitedBy.name} photoUrl={p.invitedBy.photoUrl} onOpenPerson={onOpenPerson} />
              ) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={BadgeCheck} label="Assigned shepherd">
              {p.assignedShepherd ? (
                <PersonLink personId={p.assignedShepherd.id} name={p.assignedShepherd.name} photoUrl={p.assignedShepherd.photoUrl} onOpenPerson={onOpenPerson} />
              ) : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
            <ProfileFact icon={MapPin} label="Campus">
              {has(p.campusName) ? p.campusName : <span className="text-muted-foreground">—</span>}
            </ProfileFact>
          </div>
        </ProfileSection>
      ) : null}

      {/* Groups — inline add/remove via the existing GroupPicker */}
      <ProfileSection icon={Users} title="Groups">
        <GroupPicker personId={p.id} groups={profile.groups} canManage={canGroups} onChanged={onChanged} />
      </ProfileSection>

      {/* Staff notes — the key is omitted entirely for non-staff viewers */}
      {typeof p.notes === "string" ? (
        <ProfileSection icon={FileText} title="Staff notes">
          {p.notes ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet — use “Add note” in the header.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Visible to staff only.</p>
        </ProfileSection>
      ) : null}

      {/* Allergies — omitted for viewers without access */}
      {typeof p.allergies === "string" && p.allergies ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm" role="note">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span><strong className="font-semibold">Allergy:</strong> {p.allergies}</span>
        </div>
      ) : null}
    </div>
  );
}

function labelAge(birthdate: string): string {
  const bd = new Date(birthdate);
  if (isNaN(bd.getTime())) return "";
  const now = new Date();
  let a = now.getFullYear() - bd.getFullYear();
  const m = now.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) a--;
  return `${a} yrs`;
}

// ── Family tab ───────────────────────────────────────────────────────────────

export function ProfileFamily({ profile, onChanged, onOpenPerson }: {
  profile: PersonProfile;
  onChanged: () => void;
  onOpenPerson?: (personId: string) => void;
}) {
  const qc = useQueryClient();
  const p = profile.person;
  const hh = profile.household;
  const canEdit = p.canEdit; // server-computed scoped right — parents get their own household only

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [editHouseholdOpen, setEditHouseholdOpen] = useState(false);
  const [linkGuardianOpen, setLinkGuardianOpen] = useState(false);
  const [linkDependentOpen, setLinkDependentOpen] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<{ personId: string; name: string } | null>(null);
  const [confirmUnlinkGuardian, setConfirmUnlinkGuardian] = useState<{ personId: string; name: string } | null>(null);

  const thisRole = hh?.members.find((m) => m.isThisPerson)?.role;
  const isMinor = p.privacyHidden.includes("birthday")
    ? thisRole === "child" || thisRole === "dependent"
    : labelAge(p.birthdate ?? "") !== "" && parseInt(labelAge(p.birthdate ?? ""), 10) < 18;

  async function setHouseholdRole(memberPersonId: string, role: string) {
    if (!hh) return;
    try {
      await api.patch(`/households/${hh.id}/members/${memberPersonId}`, { role });
      toast.success("Household role updated");
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  async function removeMember(memberPersonId: string) {
    if (!hh) return;
    try {
      await api.del(`/households/${hh.id}/members/${memberPersonId}`);
      toast.success("Removed from household");
      setConfirmRemoveMember(null);
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  async function patchGuardian(guardianPersonId: string, patchBody: { authorizedPickup?: boolean; custodyRestricted?: boolean }) {
    try {
      await api.patch(`/people/${p.id}/guardians/${guardianPersonId}`, patchBody);
      toast.success("Guardian updated");
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  async function unlinkGuardian(guardianPersonId: string) {
    try {
      await api.del(`/people/${p.id}/guardians/${guardianPersonId}`);
      toast.success("Guardian unlinked");
      setConfirmUnlinkGuardian(null);
      onChanged();
    } catch (err) {
      toast.error(errText(err)); // 422 needsGuardian surfaces the child-safety message
    }
  }

  return (
    <div className="space-y-4">
      {/* Household card — every member + role */}
      {hh ? (
        <ProfileSection
          icon={Home}
          title={`Household — ${hh.name}`}
          action={
            canEdit ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditHouseholdOpen(true)}>
                  Details
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddMemberOpen(true)}>
                  <Plus className="h-3 w-3" /> Add member
                </Button>
              </span>
            ) : undefined
          }
        >
          {[hh.addressLine1, hh.addressLine2, hh.city, hh.region].filter(Boolean).length > 0 ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {[hh.addressLine1, hh.addressLine2, hh.city, hh.region].filter(Boolean).join(", ")}
            </p>
          ) : null}
          <ul className="space-y-2">
            {hh.members.map((m) => (
              <li key={m.personId} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/50 px-2.5 py-2">
                <PersonLink
                  personId={m.personId}
                  name={m.name}
                  photoUrl={m.photoUrl}
                  onOpenPerson={m.isThisPerson ? undefined : onOpenPerson}
                  child={m.role === "child" || m.role === "dependent"}
                />
                {m.isThisPerson ? <Badge variant="outline" className="text-[10px]">This person</Badge> : null}
                <span className="ml-auto flex items-center gap-2">
                  {m.age != null ? <span className="text-xs tabular-nums text-muted-foreground">{m.age} yrs</span> : null}
                  {canEdit && !m.isThisPerson ? (
                    <Select value={m.role} onValueChange={(v) => void setHouseholdRole(m.personId, v)}>
                      <SelectTrigger className="h-7 w-[6.5rem] text-[11px] capitalize" aria-label={`Household role for ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HOUSEHOLD_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{HOUSEHOLD_ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] capitalize">{HOUSEHOLD_ROLE_LABELS[m.role] ?? m.role}</Badge>
                  )}
                  {canEdit && !m.isThisPerson ? (
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${m.name} from household`}
                      onClick={() => setConfirmRemoveMember({ personId: m.personId, name: m.name })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </ProfileSection>
      ) : (
        <ProfileSection icon={Home} title="Household">
          <p className="text-sm text-muted-foreground">
            Not part of a household yet{canEdit ? " — add one from the classic People view or the household picker when adding family." : "."}
          </p>
        </ProfileSection>
      )}

      {/* Guardians — prominent for minors */}
      <ProfileSection
        icon={ShieldCheck}
        title="Guardians"
        className={cn(isMinor && "border-amber-300/60 dark:border-amber-900/60")}
        action={
          canEdit ? (
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLinkGuardianOpen(true)}>
              <Plus className="h-3 w-3" /> Link guardian
            </Button>
          ) : undefined
        }
      >
        {isMinor ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> This person is a minor — at least one guardian is required.
          </p>
        ) : null}
        {profile.guardians.length === 0 ? (
          <p className={cn("text-sm", isMinor ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            No guardian linked yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {profile.guardians.map((g) => (
              <li key={g.personId} className="rounded-lg border bg-background/50 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit ? (
                    <Switch
                      checked={g.authorizedPickup}
                      onCheckedChange={(v) => void patchGuardian(g.personId, { authorizedPickup: v })}
                      aria-label={`${g.authorizedPickup ? "Revoke" : "Grant"} pickup authorization for ${g.name}`}
                      className="scale-90"
                    />
                  ) : g.authorizedPickup ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-400" aria-label="Authorized for pickup" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Not authorized for pickup" />
                  )}
                  <PersonLink personId={g.personId} name={g.name} photoUrl={g.photoUrl} onOpenPerson={onOpenPerson} />
                  <Badge variant="secondary" className="text-[10px] capitalize">{g.relationshipType}</Badge>
                  {g.isPrimary ? <Badge variant="outline" className="text-[10px]">Primary</Badge> : null}
                  {g.custodyRestricted ? (
                    <span className="flex items-center gap-1 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> custody restriction
                    </span>
                  ) : null}
                  {canEdit ? (
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                        <Switch
                          checked={g.custodyRestricted}
                          onCheckedChange={(v) => void patchGuardian(g.personId, { custodyRestricted: v })}
                          aria-label={`${g.custodyRestricted ? "Clear" : "Set"} custody restriction for ${g.name}`}
                          className="scale-75"
                        />
                        custody
                      </label>
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Unlink guardian ${g.name}`}
                        onClick={() => setConfirmUnlinkGuardian({ personId: g.personId, name: g.name })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : null}
                </div>
                {g.phone ? <p className="pl-6 text-xs text-muted-foreground">{g.phone}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      {/* Reciprocal dependents — shown on a parent's profile */}
      <ProfileSection
        icon={Heart}
        title="Children / dependents"
        action={
          canEdit ? (
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLinkDependentOpen(true)}>
              <Plus className="h-3 w-3" /> {profile.dependents.length > 0 ? "Link dependent" : "Add child"}
            </Button>
          ) : undefined
        }
      >
        {profile.dependents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No children or dependents linked yet.</p>
        ) : (
          <ul className="space-y-2">
            {profile.dependents.map((d) => (
              <li key={d.personId} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/50 px-2.5 py-2">
                <PersonLink personId={d.personId} name={d.name} photoUrl={d.photoUrl} onOpenPerson={onOpenPerson} child />
                <Badge variant="secondary" className="text-[10px] capitalize">{d.relationshipType}</Badge>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {d.age != null ? `${d.age} yrs` : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      {/* Nested dialogs — the EXISTING household/guardian endpoints */}
      {addMemberOpen && hh ? (
        <AddHouseholdMemberDialog
          householdId={hh.id}
          householdName={hh.name}
          onClose={() => setAddMemberOpen(false)}
          onDone={() => {
            setAddMemberOpen(false);
            onChanged();
          }}
        />
      ) : null}
      {editHouseholdOpen && hh ? (
        <EditHouseholdDialog
          household={{
            id: hh.id,
            name: hh.name,
            addressLine1: hh.addressLine1,
            addressLine2: hh.addressLine2,
            city: hh.city,
            region: hh.region,
            canEdit: hh.canEdit,
            members: hh.members.map((m) => ({ personId: m.personId, name: m.name, photoUrl: m.photoUrl, role: m.role })),
          }}
          onClose={() => setEditHouseholdOpen(false)}
          onDone={() => {
            setEditHouseholdOpen(false);
            onChanged();
          }}
        />
      ) : null}
      {linkGuardianOpen ? (
        <LinkGuardianDialog
          personId={p.id}
          personName={p.firstName}
          onClose={() => setLinkGuardianOpen(false)}
          onDone={() => {
            setLinkGuardianOpen(false);
            onChanged();
          }}
        />
      ) : null}
      {linkDependentOpen ? (
        <LinkDependentDialog
          personId={p.id}
          personName={p.firstName}
          onClose={() => setLinkDependentOpen(false)}
          onDone={() => {
            setLinkDependentOpen(false);
            onChanged();
          }}
        />
      ) : null}

      <AlertDialog open={confirmRemoveMember !== null} onOpenChange={(o) => !o && setConfirmRemoveMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmRemoveMember?.name} from this household?</AlertDialogTitle>
            <AlertDialogDescription>
              They stay in the directory — they just lose this household membership and its address.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRemoveMember && void removeMember(confirmRemoveMember.personId)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUnlinkGuardian !== null} onOpenChange={(o) => !o && setConfirmUnlinkGuardian(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink guardian {confirmUnlinkGuardian?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be recorded as a guardian — pickup authorization and check-in links are removed.
              A minor must keep at least one guardian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmUnlinkGuardian && void unlinkGuardian(confirmUnlinkGuardian.personId)}>
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Journey tab ──────────────────────────────────────────────────────────────

export function ProfileJourney({ profile, onChanged, canEditPeople }: {
  profile: PersonProfile;
  onChanged: () => void;
  canEditPeople: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null);
  const milestones = profile.milestones; // omitted key → journey hidden for this viewer
  const stageHistory = profile.stageHistory;

  if (milestones === undefined && stageHistory === undefined) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        The faith journey is private for this viewer role.
      </div>
    );
  }

  async function removeMilestone(id: string) {
    try {
      await api.del(`/people/v2/${profile.person.id}/milestones/${id}`);
      toast.success("Milestone removed");
      setConfirmRemove(null);
      onChanged();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  return (
    <div className="space-y-4">
      {milestones !== undefined ? (
        <ProfileSection
          icon={Sparkles}
          title="Milestones"
          action={
            canEditPeople ? (
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAddOpen(true)}>
                <Plus className="h-3 w-3" /> Add milestone
              </Button>
            ) : undefined
          }
        >
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No milestones recorded yet.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium" scope="col">Milestone</th>
                    <th className="px-3 py-2 font-medium" scope="col">Date</th>
                    <th className="px-3 py-2 font-medium" scope="col">Notes</th>
                    <th className="px-3 py-2 font-medium" scope="col">Certificate</th>
                    {canEditPeople ? <th className="px-3 py-2" scope="col"><span className="sr-only">Remove</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{milestoneLabel(m.type)}</td>
                      <td className="px-3 py-2 tabular-nums">{m.date ? fmtDate(m.date) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="max-w-56 px-3 py-2">
                        <span className="block truncate" title={m.notes ?? undefined}>{m.notes ?? <span className="text-muted-foreground">—</span>}</span>
                      </td>
                      <td className="px-3 py-2">
                        {m.certificateUrl ? (
                          <a href={m.certificateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <Link2 className="h-3 w-3" aria-hidden /> View
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {canEditPeople ? (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove ${milestoneLabel(m.type)} milestone`}
                            onClick={() => setConfirmRemove({ id: m.id, label: milestoneLabel(m.type) })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ProfileSection>
      ) : null}

      {stageHistory !== undefined && stageHistory.length > 0 ? (
        <ProfileSection icon={CalendarDays} title="Stage history">
          <ol className="relative space-y-3 border-l pl-4">
            {stageHistory.map((h, i) => (
              <li key={`${h.changedAt}-${i}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StageBadge stage={h.stage} />
                  {h.previousStage ? (
                    <span className="text-xs text-muted-foreground">from {STAGE_LABELS[h.previousStage] ?? h.previousStage}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fmtDateTime(h.changedAt)}
                  {h.changedByName ? ` · by ${h.changedByName}` : ""}
                </p>
                {h.note ? <p className="mt-0.5 text-xs italic text-muted-foreground">“{h.note}”</p> : null}
              </li>
            ))}
          </ol>
        </ProfileSection>
      ) : null}

      {canEditPeople ? (
        <AddMilestoneDialog
          open={addOpen}
          personId={profile.person.id}
          personName={`${profile.person.firstName} ${profile.person.lastName}`}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            onChanged();
          }}
        />
      ) : null}

      <AlertDialog open={confirmRemove !== null} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {confirmRemove?.label} milestone?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the milestone record from the journey. Any dates copied onto the profile stay as they were.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRemove && void removeMilestone(confirmRemove.id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Add milestone dialog (staff) ─────────────────────────────────────────────

export function AddMilestoneDialog({ open, personId, personName, onClose, onDone }: {
  open: boolean;
  personId: string;
  personName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [certificateUrl, setCertificateUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  // reset each time the dialog opens
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setType("");
    setDate("");
    setNotes("");
    setCertificateUrl("");
    setError(null);
    setKey((k) => k + 1);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  async function submit() {
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/people/v2/${personId}/milestones`, {
        type,
        date: date || undefined,
        notes: notes.trim() || undefined,
        certificateUrl: certificateUrl.trim() || undefined,
      });
      toast.success("Milestone recorded");
      void qc.invalidateQueries({ queryKey: ["people", "v2", "profile"] });
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" key={key}>
        <DialogHeader>
          <DialogTitle>Add milestone</DialogTitle>
          <DialogDescription>Record a step in {personName}&apos;s faith journey.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ms-type">Milestone *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ms-type" aria-label="Milestone type">
                <SelectValue placeholder="Pick a milestone…" />
              </SelectTrigger>
              <SelectContent>
                {MILESTONE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ms-date">Date</Label>
              <Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-cert">Certificate link</Label>
              <Input id="ms-cert" type="url" placeholder="https://…" value={certificateUrl} onChange={(e) => setCertificateUrl(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-notes">Notes</Label>
            <textarea
              id="ms-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder="Officiant, venue, class facilitator…"
            />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !type}>{busy ? "Saving…" : "Record milestone"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
