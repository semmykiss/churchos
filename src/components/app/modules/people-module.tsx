"use client";

/**
 * People — the admin's workhorse: directory, households, add w/ duplicate
 * check, person detail (edit, stage, archive), merge flow, CSV export.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, GitMerge, HandCoins, Home,
  Mail, Pencil, Phone, Plus, Search, Sparkles, UserPlus, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState, ErrorBlock, LoadingBlock, PageHeader, PersonAvatar, StageBadge,
  StatusBadge, useApiQuery, type ModuleProps,
} from "@/components/app/shared";
import { api, ApiError, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ageOf, fmtDate, fmtDateTime, fmtMoney, LIFECYCLE_STAGES, STAGE_LABELS,
  HOUSEHOLD_ROLE_LABELS, HOUSEHOLD_ROLES, canDo,
  type Dependent, type GuardianLink, type Paged, type PersonListItem,
} from "@/lib/types";
import { AvatarUpload } from "./people/AvatarUpload";
import { GuardianMultiSelect } from "./people/GuardianMultiSelect";
import { HouseholdCombobox } from "./people/HouseholdCombobox";
import CreateHouseholdDialog from "./people/CreateHouseholdDialog";
import EditHouseholdDialog from "./people/EditHouseholdDialog";
import AddHouseholdMemberDialog from "./people/AddHouseholdMemberDialog";
import LinkGuardianDialog from "./people/LinkGuardianDialog";
import LinkDependentDialog from "./people/LinkDependentDialog";
import { TagPicker } from "./people/TagPicker";
import { GroupPicker } from "./people/GroupPicker";
import { JourneyPanel } from "@/components/app/pipeline/JourneyDialog";
import { RiskSignalsSection } from "@/components/app/care/risk-signals-section";
import { PeopleCrm } from "./people/crm/people-crm";
import { PersonFormSheet } from "./people/crm/person-form-sheet";
import { savePeopleCrmPrefs, type CustomFieldDefDTO } from "./people/crm/crm-shared";
import { useFeatures } from "@/components/app/use-features";

// ── Contract shapes ──────────────────────────────────────────────────────────

interface HouseholdDTO {
  id: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  deletedAt?: string | null;
  canEdit: boolean;
  members: { personId: string; name: string; photoUrl?: string | null; role: string; email?: string | null; phone?: string | null }[];
}
interface PersonDetail {
  person: PersonListItem & { custom?: Record<string, unknown>; canEdit?: boolean };
  household: {
    id: string;
    name: string;
    addressLine1?: string | null;
    city?: string | null;
    region?: string | null;
    members: { personId: string; name: string; photoUrl?: string | null; role: string; isThisPerson: boolean }[];
  } | null;
  guardians: (GuardianLink & { isPrimary: boolean })[];
  dependents: Dependent[];
  groups: { id: string; name: string; role: string; meetingDay?: string | null; meetingTime?: string | null }[];
  stageHistory: { stage: string; previousStage?: string | null; changedAt: string; changedByName?: string | null; note?: string | null }[];
  tags: { id: string; name: string; color?: string | null }[];
  attendance: { id: string; eventName: string; eventStartsAt: string; kind?: string; status: string; method?: string; firstTime?: boolean }[];
  giving: {
    visible: boolean;
    total: number | null;
    gifts: { id: string; amountCents: number; receivedOn: string; method?: string; status?: string; funds: { name: string; amountCents: number }[] }[];
  };
  care: {
    visible: boolean;
    cases: { id: string; type: string; stage: string; status: string; urgency: string; confidentialityTier?: string; summary?: string | null; openedAt: string }[];
  };
}
interface MergeResponse {
  survivorId: string;
  mergedId: string;
  unmergeableUntil: string;
}
interface ArchiveResponse {
  id: string;
  archived: boolean;
  retainedRecords: { gifts: number; attendance: number };
}

const PAGE_SIZE = 25;
const MERGE_FIELDS = ["firstName", "lastName", "email", "phone", "birthdate"] as const;
type MergeField = (typeof MERGE_FIELDS)[number];
type Survivors = Record<MergeField, "survivor" | "merged">;

const FIELD_LABELS: Record<MergeField, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  birthdate: "Birthdate",
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function fullName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

function fieldOf(p: PersonListItem | null, field: MergeField): string {
  if (!p) return "—";
  const v = p[field];
  return typeof v === "string" && v.length > 0 ? v : "—";
}

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

// ── (Phase 6) The classic add dialog was redesigned as the
// crm/person-form-sheet slide-over — same POST /people contract (live
// duplicate detection + force flow + guardian links), progressive disclosure,
// "Save and add another / family member", custom fields and consent.

// ── Person detail dialog ─────────────────────────────────────────────────────

function PersonDetailDialog({ personId, viewerPersonId, canGive, canStage, canArchive, canManageTags, canManageGroups, canPipelineView, onClose }: {
  personId: string;
  viewerPersonId: string | null;
  canGive: boolean;
  canStage: boolean;
  canArchive: boolean;
  canManageTags: boolean;
  canManageGroups: boolean;
  canPipelineView: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // internal navigation: clicking a dependent / household member swaps the viewed person
  const [viewId, setViewId] = useState(personId);
  useEffect(() => setViewId(personId), [personId]);
  const detailQ = useApiQuery<PersonDetail>(["people", "detail", viewId], `/people/${viewId}`);
  const d = detailQ.data;

  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ firstName: "", lastName: "", preferredName: "", email: "", phone: "", birthdate: "" });
  const [saving, setSaving] = useState(false);
  const [stagePick, setStagePick] = useState("");
  const [stageNote, setStageNote] = useState("");
  const [stageBusy, setStageBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [linkGuardianOpen, setLinkGuardianOpen] = useState(false);
  const [linkDependentOpen, setLinkDependentOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<{ personId: string; name: string } | null>(null);
  const [confirmUnlinkGuardian, setConfirmUnlinkGuardian] = useState<{ personId: string; name: string } | null>(null);

  // reset transient edit state when navigating between people
  useEffect(() => {
    setEditing(false);
    setStagePick("");
    setStageNote("");
  }, [viewId]);

  function invalidatePeople() {
    void qc.invalidateQueries({ queryKey: ["people"] });
    void qc.invalidateQueries({ queryKey: ["households"] });
  }

  function startEdit(p: PersonListItem) {
    setEdit({
      firstName: p.firstName,
      lastName: p.lastName,
      preferredName: p.preferredName ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      // API returns a full ISO timestamp; <input type="date"> needs YYYY-MM-DD
      // (a raw timestamp renders as an empty mm/dd/yyyy and would 500 on save).
      birthdate: p.birthdate ? p.birthdate.slice(0, 10) : "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!d) return;
    setSaving(true);
    try {
      await api.put(`/people/${viewId}`, {
        firstName: edit.firstName.trim(),
        lastName: edit.lastName.trim(),
        preferredName: edit.preferredName.trim() || undefined,
        email: edit.email.trim() || undefined,
        phone: edit.phone.trim() || undefined,
        birthdate: edit.birthdate || undefined,
      });
      toast.success("Profile updated");
      setEditing(false);
      invalidatePeople();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSaving(false);
    }
  }

  async function changeStage() {
    if (!d || !stagePick) return;
    setStageBusy(true);
    try {
      await api.post(`/people/${viewId}/stage`, { stage: stagePick, note: stageNote.trim() || undefined });
      toast.success(`${d.person.firstName} moved to ${STAGE_LABELS[stagePick] ?? stagePick}`);
      setStagePick("");
      setStageNote("");
      invalidatePeople();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setStageBusy(false);
    }
  }

  async function archive() {
    setArchiving(true);
    try {
      const res = await api.post<ArchiveResponse>(`/people/${viewId}/archive`);
      toast.success(
        `Archived — records retained: ${res.retainedRecords.gifts} gifts, ${res.retainedRecords.attendance} attendance.`,
      );
      invalidatePeople();
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setArchiving(false);
    }
  }

  async function patchGuardian(guardianPersonId: string, patchBody: { authorizedPickup?: boolean; custodyRestricted?: boolean }) {
    try {
      await api.patch(`/people/${viewId}/guardians/${guardianPersonId}`, patchBody);
      toast.success("Guardian updated");
      invalidatePeople();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  async function unlinkGuardian(guardianPersonId: string) {
    try {
      await api.del(`/people/${viewId}/guardians/${guardianPersonId}`);
      toast.success("Guardian unlinked");
      setConfirmUnlinkGuardian(null);
      invalidatePeople();
    } catch (err) {
      toast.error(errText(err)); // 422 needsGuardian surfaces the child-safety message
    }
  }

  async function setHouseholdRole(memberPersonId: string, role: string) {
    if (!d?.household) return;
    try {
      await api.patch(`/households/${d.household.id}/members/${memberPersonId}`, { role });
      toast.success("Household role updated");
      invalidatePeople();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  async function removeMember(memberPersonId: string) {
    if (!d?.household) return;
    try {
      await api.del(`/households/${d.household.id}/members/${memberPersonId}`);
      toast.success("Removed from household");
      setConfirmRemoveMember(null);
      invalidatePeople();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  const p = d?.person;
  const canEdit = d?.person.canEdit === true;
  const thisRole = d?.household?.members.find((m) => m.isThisPerson)?.role;
  const isMinorChild = p != null && ((ageOf(p.birthdate) != null && (ageOf(p.birthdate) ?? 0) < 18) || thisRole === "child" || thisRole === "dependent");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {detailQ.isLoading || !p || detailQ.error ? (
        // Loading / error state — keep an accessible title even though the
        // header (with the real DialogTitle) has not rendered yet.
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scroll-slim" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{detailQ.error ? "Person details unavailable" : "Loading person…"}</DialogTitle>
          {detailQ.isLoading || !p ? <LoadingBlock label="Loading person…" /> : <ErrorBlock error={detailQ.error} />}
        </DialogContent>
      ) : (
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scroll-slim">
        <>
            <DialogHeader>
              <div className="flex items-start gap-3 pr-6 text-left">
                <AvatarUpload
                  personId={viewId}
                  name={fullName(p)}
                  photoUrl={p.photoUrl}
                  canEdit={canEdit}
                  className="h-12 w-12 text-sm"
                  onChanged={() => invalidatePeople()}
                />
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <span className="truncate">{fullName(p)}</span>
                    <StageBadge stage={p.lifecycleStage} />
                    {p.status === "archived" ? <StatusBadge status="archived" /> : null}
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {p.allergies ? (
                        <Badge variant="outline" className="border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">
                          Allergy: {p.allergies}
                        </Badge>
                      ) : null}
                      <TagPicker
                        personId={viewId}
                        tags={d.tags}
                        canManage={canManageTags}
                        onChanged={() => invalidatePeople()}
                      />
                    </div>
                  </DialogDescription>
                </div>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant={editing ? "secondary" : "outline"}
                    className="ml-auto shrink-0"
                    onClick={() => (editing ? setEditing(false) : startEdit(p))}
                  >
                    <Pencil className="h-3.5 w-3.5" /> {editing ? "Cancel edit" : "Edit"}
                  </Button>
                ) : null}
              </div>
            </DialogHeader>

            <div className="space-y-5">
              {/* Contact info / inline edit */}
              {editing ? (
                <div className="rounded-lg border p-3">
                  <form
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveEdit();
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-first">First name</Label>
                      <Input id="ed-first" value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-last">Last name</Label>
                      <Input id="ed-last" value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-pref">Preferred name</Label>
                      <Input id="ed-pref" value={edit.preferredName} onChange={(e) => setEdit({ ...edit, preferredName: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-birth">Birthdate</Label>
                      <Input id="ed-birth" type="date" value={edit.birthdate} onChange={(e) => setEdit({ ...edit, birthdate: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-email">Email</Label>
                      <Input id="ed-email" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ed-phone">Phone</Label>
                      <Input id="ed-phone" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <Button type="submit" size="sm" disabled={saving}>
                        {saving ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </form>
                </div>
              ) : (
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <dt className="sr-only">Email</dt>
                    <dd className="truncate">{p.email ?? <span className="text-muted-foreground">No email</span>}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <dt className="sr-only">Phone</dt>
                    <dd className="truncate">{p.phone ?? <span className="text-muted-foreground">No phone</span>}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Age</dt>
                    <dd>
                      {ageOf(p.birthdate) != null ? `${ageOf(p.birthdate)} · born ${fmtDate(p.birthdate)}` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">First visit</dt>
                    <dd>{fmtDate(p.firstVisitAt)}</dd>
                  </div>
                  {d.household ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">Household</dt>
                      <dd>
                        {d.household.name}
                        {d.household.addressLine1 ? ` — ${[d.household.addressLine1, d.household.city, d.household.region].filter(Boolean).join(", ")}` : ""}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}

              <Separator />

              {/* Household + guardians — actionable when canEdit */}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {d.household ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Household — {d.household.name}
                      </h3>
                      {canEdit ? (
                        <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => setAddMemberOpen(true)}>
                          <Plus className="h-3 w-3" /> Add member
                        </Button>
                      ) : null}
                    </div>
                    <ul className="space-y-1.5">
                      {d.household.members.map((m) => (
                        <li key={m.personId} className="flex items-center gap-2 text-sm">
                          <PersonAvatar name={m.name} src={m.photoUrl} className="h-6 w-6 text-[9px]" />
                          {m.isThisPerson ? (
                            <span className="min-w-0 flex-1 truncate">{m.name}</span>
                          ) : (
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left hover:underline"
                              onClick={() => setViewId(m.personId)}
                              aria-label={`Open ${m.name}`}
                            >
                              {m.name}
                            </button>
                          )}
                          {canEdit ? (
                            <Select value={m.role} onValueChange={(v) => void setHouseholdRole(m.personId, v)}>
                              <SelectTrigger
                                className="h-6 w-[6.5rem] shrink-0 text-[10px] capitalize"
                                aria-label={`Household role for ${m.name}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {HOUSEHOLD_ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>{HOUSEHOLD_ROLE_LABELS[r]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] capitalize">{m.role}</Badge>
                          )}
                          {m.isThisPerson ? <Badge variant="outline" className="text-[10px]">This person</Badge> : null}
                          {canEdit ? (
                            <button
                              type="button"
                              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Remove ${m.name} from household`}
                              onClick={() => setConfirmRemoveMember({ personId: m.personId, name: m.name })}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {d.guardians.length > 0 || (canEdit && isMinorChild) ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guardians</h3>
                      {canEdit ? (
                        <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => setLinkGuardianOpen(true)}>
                          <Plus className="h-3 w-3" /> Link guardian
                        </Button>
                      ) : null}
                    </div>
                    {d.guardians.length === 0 ? (
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        No guardian linked yet — minors need at least one.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {d.guardians.map((g) => (
                          <li key={g.personId} className="text-sm">
                            <div className="flex items-center gap-1.5">
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
                              <button
                                type="button"
                                className="min-w-0 truncate font-medium hover:underline"
                                onClick={() => setViewId(g.personId)}
                                aria-label={`Open ${g.name}`}
                              >
                                {g.name}
                              </button>
                              <Badge variant="secondary" className="text-[10px] capitalize">{g.relationshipType}</Badge>
                              {g.custodyRestricted ? (
                                <span className="flex items-center gap-1 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3" /> custody restriction
                                </span>
                              ) : null}
                              {canEdit ? (
                                <span className="ml-auto flex shrink-0 items-center gap-1">
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
                            {g.phone ? <p className="pl-5 text-xs text-muted-foreground">{g.phone}</p> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}

                {/* Groups — inline add/remove via GroupPicker */}
                <div className="sm:col-span-2">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groups</h3>
                  <GroupPicker
                    personId={viewId}
                    groups={d.groups}
                    canManage={canManageGroups}
                    onChanged={() => invalidatePeople()}
                  />
                </div>
              </div>

              {/* Dependents — reciprocal of Guardians, shown on a PARENT's profile */}
              {d.dependents.length > 0 || (canEdit && (thisRole === "head" || thisRole === "spouse")) ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Children / Dependents
                    </h3>
                    {canEdit ? (
                      <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => setLinkDependentOpen(true)}>
                        <Plus className="h-3 w-3" /> {d.dependents.length > 0 ? "Link dependent" : "Add child or dependent"}
                      </Button>
                    ) : null}
                  </div>
                  {d.dependents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No children or dependents linked yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {d.dependents.map((dep) => (
                        <li key={dep.personId} className="flex items-center gap-2 text-sm">
                          <PersonAvatar name={dep.name} src={dep.photoUrl} child className="h-6 w-6 text-[9px]" />
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left hover:underline"
                            onClick={() => setViewId(dep.personId)}
                            aria-label={`Open ${dep.name}`}
                          >
                            {dep.name}
                          </button>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {ageOf(dep.birthdate) != null ? `${ageOf(dep.birthdate)} yrs` : "—"}
                          </span>
                          <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                            {dep.relationshipType}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {/* Stage history */}
              {d.stageHistory.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage history</h3>
                  <ol className="relative space-y-3 border-l pl-4">
                    {d.stageHistory.map((h, i) => (
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
                </div>
              ) : null}

              {/* Attendance */}
              {d.attendance.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent attendance
                  </h3>
                  <ul className="max-h-48 space-y-1.5 overflow-y-auto scroll-slim pr-1">
                    {d.attendance.slice(0, 10).map((a) => (
                      <li key={a.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{a.eventName}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(a.eventStartsAt)}</span>
                        <StatusBadge status={a.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Giving — role-gated per viewer (server-computed) */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Giving</h3>
                  {viewId === viewerPersonId && canGive ? (
                    <Button
                      size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                      onClick={() => window.dispatchEvent(new CustomEvent("chms:navigate", { detail: "giving" }))}
                    >
                      <HandCoins className="h-3 w-3" /> Give now
                    </Button>
                  ) : null}
                </div>
                {d.giving.visible ? (
                  d.giving.gifts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recorded gifts.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-sm">
                        <span className="font-semibold tabular-nums">{fmtMoney(d.giving.total)}</span>
                        <span className="text-muted-foreground"> lifetime · {d.giving.gifts.length} gifts</span>
                      </p>
                      <ul className="max-h-48 space-y-1.5 overflow-y-auto scroll-slim pr-1">
                        {d.giving.gifts.map((g) => (
                          <li key={g.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                            <span className="font-medium tabular-nums">{fmtMoney(g.amountCents)}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {[g.method, g.funds.map((f) => f.name).join(", ")].filter(Boolean).join(" · ")}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(g.receivedOn)}</span>
                            {g.status ? <StatusBadge status={g.status} /> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">Giving hidden for your role.</p>
                )}
              </div>

              {/* Care cases — only when visible */}
              {d.care.visible && d.care.cases.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Care cases</h3>
                  <ul className="space-y-1.5">
                    {d.care.cases.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{c.type}</span>
                        <StatusBadge status={c.status} />
                        <Badge variant="outline" className="text-[10px] capitalize">{c.urgency}</Badge>
                        <span className="text-xs text-muted-foreground">opened {fmtDate(c.openedAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {/* Journey — pipeline position + touchpoints (pipeline.view only; the endpoint is permission-gated) */}
              {canPipelineView ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Journey</h3>
                  <JourneyPanel personId={viewId} />
                </div>
              ) : null}
              {/* Risk Signals — Care Radar (additive section; server enforces care.risk.view scope + giving visibility) */}
              <RiskSignalsSection personId={viewId} />
            </div>

            {/* Actions — stage/archive stay staff-only (flat permissions) */}
            {canStage || canArchive ? (
              <>
                <Separator />
                <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:space-x-0">
                  {canStage ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="detail-stage">Change lifecycle stage</Label>
                        <Select value={stagePick} onValueChange={setStagePick}>
                          <SelectTrigger id="detail-stage" aria-label="Change lifecycle stage">
                            <SelectValue placeholder="Pick a stage…" />
                          </SelectTrigger>
                          <SelectContent>
                            {LIFECYCLE_STAGES.filter((s) => s !== p.lifecycleStage).map((s) => (
                              <SelectItem key={s} value={s}>
                                {STAGE_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="detail-stage-note">Note (optional)</Label>
                        <Input id="detail-stage-note" value={stageNote} onChange={(e) => setStageNote(e.target.value)} placeholder="Why the move?" />
                      </div>
                      <Button type="button" disabled={!stagePick || stageBusy} onClick={() => void changeStage()}>
                        {stageBusy ? "Moving…" : "Update stage"}
                      </Button>
                    </div>
                  ) : null}
                  {canArchive && p.status !== "archived" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="destructive" className="self-start" disabled={archiving}>
                          {archiving ? "Archiving…" : "Archive person"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Archive {p.firstName} {p.lastName}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They will be hidden from lists and cannot be picked for new activity, but their giving and
                            attendance records are retained for reporting.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void archive()}>Archive</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </DialogFooter>
              </>
            ) : null}

            {/* Nested dialogs — household / guardian / dependent management */}
            {linkGuardianOpen && p ? (
              <LinkGuardianDialog
                personId={viewId}
                personName={p.firstName}
                onClose={() => setLinkGuardianOpen(false)}
                onDone={() => {
                  setLinkGuardianOpen(false);
                  invalidatePeople();
                }}
              />
            ) : null}
            {linkDependentOpen && p ? (
              <LinkDependentDialog
                personId={viewId}
                personName={p.firstName}
                onClose={() => setLinkDependentOpen(false)}
                onDone={() => {
                  setLinkDependentOpen(false);
                  invalidatePeople();
                }}
              />
            ) : null}
            {addMemberOpen && d.household ? (
              <AddHouseholdMemberDialog
                householdId={d.household.id}
                householdName={d.household.name}
                onClose={() => setAddMemberOpen(false)}
                onDone={() => {
                  setAddMemberOpen(false);
                  invalidatePeople();
                }}
              />
            ) : null}

            {/* Confirm: remove household member */}
            <AlertDialog
              open={confirmRemoveMember !== null}
              onOpenChange={(o) => !o && setConfirmRemoveMember(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {confirmRemoveMember?.name} from this household?</AlertDialogTitle>
                  <AlertDialogDescription>
                    They stay in the directory — they just lose this household membership and its address.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => confirmRemoveMember && void removeMember(confirmRemoveMember.personId)}
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Confirm: unlink guardian (server blocks the last guardian of a minor) */}
            <AlertDialog
              open={confirmUnlinkGuardian !== null}
              onOpenChange={(o) => !o && setConfirmUnlinkGuardian(null)}
            >
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
                  <AlertDialogAction
                    onClick={() => confirmUnlinkGuardian && void unlinkGuardian(confirmUnlinkGuardian.personId)}
                  >
                    Unlink
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
      </DialogContent>
      )}
    </Dialog>
  );
}

// ── Merge dialog ─────────────────────────────────────────────────────────────

function MergeDialog({ onDone, onClose, initialMergedId }: { onDone: () => void; onClose: () => void; initialMergedId?: string | null }) {
  const qc = useQueryClient();
  const poolQ = useApiQuery<Paged<PersonListItem>>(["people", "merge-pool"], "/people?pageSize=100");
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  // Phase 6: opened from the duplicate card — the duplicate is pre-picked.
  const [mergedId, setMergedId] = useState<string | null>(initialMergedId ?? null);
  const [sFilter, setSFilter] = useState("");
  const [mFilter, setMFilter] = useState("");
  const [survivors, setSurvivors] = useState<Survivors>({
    firstName: "survivor",
    lastName: "survivor",
    email: "survivor",
    phone: "survivor",
    birthdate: "survivor",
  });
  const [busy, setBusy] = useState(false);

  const pool = poolQ.data?.items ?? [];
  const match = (p: PersonListItem, q: string) =>
    `${p.firstName} ${p.lastName} ${p.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());
  const survivorsList = pool.filter((p) => match(p, sFilter) && p.id !== mergedId);
  const mergedList = pool.filter((p) => match(p, mFilter) && p.id !== survivorId);
  const survivor = pool.find((p) => p.id === survivorId) ?? null;
  const merged = pool.find((p) => p.id === mergedId) ?? null;

  // Default each field to whichever side has a value (survivor wins ties).
  useEffect(() => {
    if (!survivor || !merged) return;
    const next = { ...survivors };
    let changed = false;
    for (const f of MERGE_FIELDS) {
      const hasS = typeof survivor[f] === "string" && (survivor[f] as string).length > 0;
      const hasM = typeof merged[f] === "string" && (merged[f] as string).length > 0;
      const want: "survivor" | "merged" = hasS || !hasM ? "survivor" : "merged";
      if (next[f] !== want) {
        next[f] = want;
        changed = true;
      }
    }
    if (changed) setSurvivors(next);
  }, [survivor, merged, survivors]);

  async function doMerge() {
    if (!survivorId || !mergedId) return;
    setBusy(true);
    try {
      const res = await api.post<MergeResponse>("/people/merge", {
        survivorId,
        mergedId,
        survivors,
      });
      const s = pool.find((p) => p.id === res.survivorId);
      const m = pool.find((p) => p.id === res.mergedId);
      toast.success(
        `Merged ${m ? `${m.firstName} ${m.lastName}` : "duplicate"} into ${s ? `${s.firstName} ${s.lastName}` : "survivor"} — unmergeable until ${fmtDate(res.unmergeableUntil)}.`,
      );
      void qc.invalidateQueries({ queryKey: ["people"] });
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  function Picker({
    side, label, filter, setFilter, list, selectedId, pick,
  }: {
    side: "survivor" | "merged";
    label: string;
    filter: string;
    setFilter: (v: string) => void;
    list: PersonListItem[];
    selectedId: string | null;
    pick: (id: string) => void;
  }) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`merge-${side}`}>{label}</Label>
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <Input
            id={`merge-${side}`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search name or email…"
            className="h-8"
            aria-label={`Search ${side} candidates`}
          />
        </div>
        <ul
          className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1"
          aria-label={`${label} candidates`}
        >
          {poolQ.isLoading ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</li>
          ) : list.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</li>
          ) : (
            list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pick(p.id)}
                  aria-pressed={selectedId === p.id}
                  className={cn(
                    "row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    selectedId === p.id && "bg-primary/15",
                  )}
                >
                  <PersonAvatar name={`${p.firstName} ${p.lastName}`} className="h-6 w-6 text-[9px]" />
                  <span className="min-w-0 flex-1 truncate">{p.firstName} {p.lastName}</span>
                  <span className="max-w-32 truncate text-[11px] text-muted-foreground">{p.email ?? ""}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scroll-slim">
        <DialogHeader>
          <DialogTitle>Merge duplicate people</DialogTitle>
          <DialogDescription>
            Pick the record to keep (survivor) and the one to fold in. The merged record is archived and can be
            unmerged for 30 days.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Picker
            side="survivor" label="Survivor (keep)" filter={sFilter} setFilter={setSFilter}
            list={survivorsList} selectedId={survivorId} pick={setSurvivorId}
          />
          <Picker
            side="merged" label="Merged (fold in)" filter={mFilter} setFilter={setMFilter}
            list={mergedList} selectedId={mergedId} pick={setMergedId}
          />
        </div>

        {survivor && merged ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>{survivor.firstName} {survivor.lastName}</TableHead>
                  <TableHead>{merged.firstName} {merged.lastName}</TableHead>
                  <TableHead className="text-right">Keep</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MERGE_FIELDS.map((f) => (
                  <TableRow key={f}>
                    <TableCell className="text-xs text-muted-foreground">{FIELD_LABELS[f]}</TableCell>
                    <TableCell className="max-w-40 truncate">{fieldOf(survivor, f)}</TableCell>
                    <TableCell className="max-w-40 truncate">{fieldOf(merged, f)}</TableCell>
                    <TableCell>
                      <div
                        role="radiogroup"
                        aria-label={`Keep ${FIELD_LABELS[f]} from`}
                        className="flex justify-end gap-3 text-xs"
                      >
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="radio"
                            name={`field-${f}`}
                            checked={survivors[f] === "survivor"}
                            onChange={() => setSurvivors({ ...survivors, [f]: "survivor" })}
                            aria-label={`${FIELD_LABELS[f]}: keep survivor value`}
                          />
                          Survivor
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="radio"
                            name={`field-${f}`}
                            checked={survivors[f] === "merged"}
                            onChange={() => setSurvivors({ ...survivors, [f]: "merged" })}
                            aria-label={`${FIELD_LABELS[f]}: use merged value`}
                          />
                          Merged
                        </label>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">Choose both records to see the field-by-field plan.</p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!survivorId || !mergedId || busy} onClick={() => void doMerge()}>
            {busy ? "Merging…" : "Confirm merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Module ───────────────────────────────────────────────────────────────────

/**
 * People module entry — routes between the next-gen CRM (flag: people.crmV2)
 * and the classic view. Both stay reachable: the CRM header offers "Classic
 * view", and the preference (`peopleCrm.view`) persists the choice per user.
 * While flags are loading we assume the default (enabled).
 */
export default function PeopleModule({ user }: ModuleProps) {
  const features = useFeatures();
  const [override, setOverride] = useState<"crm" | "classic" | null>(null);
  // Phase 6 — duplicate-card "Merge" from the CRM opens the merge flow preset.
  const [crmMergePreset, setCrmMergePreset] = useState<string | null>(null);

  let prefView: "crm" | "classic" = "crm";
  try {
    const raw = JSON.parse(user.preferences ?? "{}") as { peopleCrm?: { view?: "crm" | "classic" } };
    if (raw.peopleCrm?.view === "classic") prefView = "classic";
  } catch {
    /* default crm */
  }
  const crmOn = features ? features["people.crmV2"] !== false : true;
  const view = override ?? prefView;

  if (crmOn && view === "crm") {
    return (
      <>
        <PeopleCrm
          user={user}
          canCreate={canDo(user, "people.create")}
          canBulk={canDo(user, "people.bulk")}
          canViewsManage={canDo(user, "people.views.manage")}
          canEditPeople={canDo(user, "people.edit")}
          canTags={canDo(user, "people.tags.manage")}
          canGroups={canDo(user, "people.groups.manage") || canDo(user, "groups.manage")}
          canArchive={canDo(user, "people.archive")}
          canManageCustomFields={canDo(user, "people.customfields.manage")}
          onClassic={() => {
            setOverride("classic");
            void savePeopleCrmPrefs({ view: "classic" });
          }}
          openMergeWith={(duplicateId) => setCrmMergePreset(duplicateId)}
        />
        {crmMergePreset ? (
          <MergeDialog
            initialMergedId={crmMergePreset}
            onClose={() => setCrmMergePreset(null)}
            onDone={() => setCrmMergePreset(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <PeopleClassic
      user={user}
      crmAvailable={crmOn}
      onBackToCrm={() => {
        setOverride("crm");
        void savePeopleCrmPrefs({ view: "crm" });
      }}
    />
  );
}

function PeopleClassic({ user, crmAvailable, onBackToCrm }: ModuleProps & { crmAvailable: boolean; onBackToCrm: () => void }) {
  const qc = useQueryClient();
  // wildcard-aware client gate (mirrors the server can()) — owner roles carry "*"
  const can = (perm: string) => canDo(user, perm);
  const canCreate = can("people.create");
  const canMerge = can("people.merge");
  const canManageHouseholds = can("people.edit"); // creating/renaming households is a staff action
  const canExport = can("people.edit"); // bulk CSV export is a staff action

  const [tab, setTab] = useState("people");

  // People tab state
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText);
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const filterKey = `${search}|${stage}|${status}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }
  const [addOpen, setAddOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePreset, setMergePreset] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Phase 6 — the slide-over needs the same custom-field definitions the CRM uses
  const cfDefsQ = useApiQuery<{ items: CustomFieldDefDTO[] }>(
    ["people", "customfields"],
    "/people/custom-fields",
    { staleTime: 60_000 }
  );
  const cfDefs = cfDefsQ.data?.items ?? [];

  // Households tab state
  const [hhText, setHhText] = useState("");
  const hhSearch = useDebounced(hhText);
  const [createHouseholdOpen, setCreateHouseholdOpen] = useState(false);
  const [editHousehold, setEditHousehold] = useState<HouseholdDTO | null>(null);
  const [addMemberHousehold, setAddMemberHousehold] = useState<HouseholdDTO | null>(null);
  const [removeCardMember, setRemoveCardMember] = useState<{ householdId: string; personId: string; name: string } | null>(null);

  function invalidateHouseholdData() {
    void qc.invalidateQueries({ queryKey: ["households"] });
    void qc.invalidateQueries({ queryKey: ["people"] });
  }

  async function setCardMemberRole(householdId: string, personId: string, role: string) {
    try {
      await api.patch(`/households/${householdId}/members/${personId}`, { role });
      toast.success("Household role updated");
      invalidateHouseholdData();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  async function removeMemberFromHousehold() {
    if (!removeCardMember) return;
    try {
      await api.del(`/households/${removeCardMember.householdId}/members/${removeCardMember.personId}`);
      toast.success("Removed from household");
      setRemoveCardMember(null);
      invalidateHouseholdData();
    } catch (err) {
      toast.error(errText(err));
    }
  }

  const peopleQ = useApiQuery<Paged<PersonListItem>>(
    ["people", "list", { search, stage, status, page }],
    `/people${qs({
      search: search || undefined,
      stage: stage === "all" ? undefined : stage,
      status: status === "all" ? undefined : status,
      page,
      pageSize: PAGE_SIZE,
    })}`,
  );

  const householdsQ = useApiQuery<{ items: HouseholdDTO[] }>(
    ["households", hhSearch],
    `/households${qs({ search: hhSearch || undefined })}`,
    { enabled: tab === "households" },
  );

  const list = peopleQ.data;
  const items = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  function exportCsv() {
    window.open("/api/v1/people/export.csv", "_blank");
    toast("Export started — check your downloads.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        description="The congregation directory — households, stages, follow-up and records."
        actions={
          <>
            {crmAvailable ? (
              <Button type="button" variant="secondary" onClick={onBackToCrm} aria-label="Switch to the next-gen People CRM">
                <Sparkles className="h-4 w-4" /> New CRM
              </Button>
            ) : null}
            {canCreate ? (
              <Button type="button" onClick={() => setAddOpen(true)}>
                <UserPlus className="h-4 w-4" /> Add person
              </Button>
            ) : null}
            {canExport ? (
              <Button type="button" variant="outline" onClick={exportCsv} aria-label="Export people as CSV">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            ) : null}
            {canMerge ? (
              <Button type="button" variant="secondary" onClick={() => setMergeOpen(true)}>
                <GitMerge className="h-4 w-4" /> Merge duplicates
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="households">Households</TabsTrigger>
        </TabsList>

        {/* ── People tab ── */}
        <TabsContent value="people" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search name, email or phone…"
                className="pl-8"
                aria-label="Search people"
              />
            </div>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger className="w-40" aria-label="Filter by stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm tabular-nums text-muted-foreground">
              {list ? `${total} ${total === 1 ? "person" : "people"}` : "…"}
            </span>
          </div>

          {peopleQ.isLoading ? (
            <LoadingBlock label="Loading people…" />
          ) : peopleQ.error ? (
            <ErrorBlock error={peopleQ.error} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No people match"
              description={search ? `Nothing found for “${search}”. Try a different spelling.` : "Add your first person to get started."}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="w-16">Age</TableHead>
                    <TableHead>Household</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="w-10"><span className="sr-only">Open</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow
                      key={p.id}
                      tabIndex={0}
                      onClick={() => setSelectedId(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(p.id);
                        }
                      }}
                      aria-label={`Open ${fullName(p)}`}
                      className="row-hover cursor-pointer"
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <PersonAvatar name={`${p.firstName} ${p.lastName}`} src={p.photoUrl} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {p.firstName} {p.lastName}
                              {p.preferredName ? <span className="font-normal text-muted-foreground"> ({p.preferredName})</span> : null}
                            </p>
                            {p.tags && p.tags.length > 0 ? (
                              <p className="truncate text-[11px] text-muted-foreground">{p.tags.map((t) => t.name).join(" · ")}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-52 space-y-0.5">
                          <p className="truncate text-xs">{p.email ?? <span className="text-muted-foreground">—</span>}</p>
                          <p className="truncate text-xs text-muted-foreground">{p.phone ?? ""}</p>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">{ageOf(p.birthdate) ?? "—"}</TableCell>
                      <TableCell>
                        {p.household ? (
                          <span className="text-sm">
                            {p.household.name}
                            <span className="text-xs text-muted-foreground"> · <span className="capitalize">{p.household.role}</span></span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><StageBadge stage={p.lifecycleStage} /></TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`View ${p.firstName} ${p.lastName}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(p.id);
                          }}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {list && total > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground tabular-nums">
                {from}–{to} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((n) => Math.max(1, n - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="text-sm tabular-nums text-muted-foreground">Page {page} of {totalPages}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                  aria-label="Next page"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>

        {/* ── Households tab ── */}
        <TabsContent value="households" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={hhText}
                onChange={(e) => setHhText(e.target.value)}
                placeholder="Search households…"
                className="pl-8"
                aria-label="Search households"
              />
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {householdsQ.data ? `${householdsQ.data.items.length} ${householdsQ.data.items.length === 1 ? "household" : "households"}` : "…"}
            </span>
            {canManageHouseholds ? (
              <Button type="button" onClick={() => setCreateHouseholdOpen(true)}>
                <Plus className="h-4 w-4" /> New household
              </Button>
            ) : null}
          </div>

          {householdsQ.isLoading ? (
            <LoadingBlock label="Loading households…" />
          ) : householdsQ.error ? (
            <ErrorBlock error={householdsQ.error} />
          ) : (householdsQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No households found" description={hhSearch ? `Nothing matches “${hhSearch}”.` : "Households appear as people are added."} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {householdsQ.data?.items.map((h) => (
                <div key={h.id} className="rounded-lg border bg-card p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{h.name}</span>
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[h.addressLine1, h.city, h.region].filter(Boolean).join(", ") || "No address on file"}
                      </p>
                    </div>
                    {h.canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label={`Edit ${h.name}`}
                        onClick={() => setEditHousehold(h)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <Separator className="my-3" />
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto scroll-slim">
                    {h.members.map((m) => (
                      <li key={m.personId} className="flex items-center gap-2 text-sm">
                        <PersonAvatar name={m.name} src={m.photoUrl} className="h-6 w-6 text-[9px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{m.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[m.email, m.phone].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        {h.canEdit ? (
                          <Select value={m.role} onValueChange={(v) => void setCardMemberRole(h.id, m.personId, v)}>
                            <SelectTrigger
                              className="h-6 w-[6.5rem] shrink-0 text-[10px] capitalize"
                              aria-label={`Household role for ${m.name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HOUSEHOLD_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>{HOUSEHOLD_ROLE_LABELS[r]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">{m.role}</Badge>
                        )}
                        {h.canEdit ? (
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove ${m.name} from ${h.name}`}
                            onClick={() => setRemoveCardMember({ householdId: h.id, personId: m.personId, name: m.name })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {h.canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => setAddMemberHousehold(h)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add member
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {addOpen ? (
        /* Phase 6 — the ONE add form (slide-over) replaced the classic dialog */
        <PersonFormSheet
          open
          mode="add"
          customFields={cfDefs}
          viewerRoleKeys={user.roleKeys ?? []}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["people"] });
          }}
          onOpenPerson={(id) => {
            setAddOpen(false);
            setSelectedId(id);
          }}
          onMergeRequested={(dupId) => {
            setAddOpen(false);
            setMergePreset(dupId);
          }}
        />
      ) : null}

      {mergePreset ? (
        <MergeDialog
          initialMergedId={mergePreset}
          onClose={() => setMergePreset(null)}
          onDone={() => setMergePreset(null)}
        />
      ) : null}

      {mergeOpen ? <MergeDialog onClose={() => setMergeOpen(false)} onDone={() => setMergeOpen(false)} /> : null}

      {createHouseholdOpen ? (
        <CreateHouseholdDialog
          onClose={() => setCreateHouseholdOpen(false)}
          onDone={() => {
            setCreateHouseholdOpen(false);
            invalidateHouseholdData();
          }}
        />
      ) : null}

      {editHousehold ? (
        <EditHouseholdDialog
          household={editHousehold}
          onClose={() => setEditHousehold(null)}
          onDone={() => {
            setEditHousehold(null);
            invalidateHouseholdData();
          }}
        />
      ) : null}

      {addMemberHousehold ? (
        <AddHouseholdMemberDialog
          householdId={addMemberHousehold.id}
          householdName={addMemberHousehold.name}
          onClose={() => setAddMemberHousehold(null)}
          onDone={() => {
            setAddMemberHousehold(null);
            invalidateHouseholdData();
          }}
        />
      ) : null}

      {/* Confirm: remove household member from a household card */}
      <AlertDialog open={removeCardMember !== null} onOpenChange={(o) => !o && setRemoveCardMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeCardMember?.name} from this household?</AlertDialogTitle>
            <AlertDialogDescription>
              They stay in the directory — they just lose this household membership and its address.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeMemberFromHousehold()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedId ? (
        <PersonDetailDialog
          personId={selectedId}
          viewerPersonId={user.personId}
          canGive={can("giving.give")}
          canStage={can("people.edit")}
          canArchive={can("people.archive")}
          canManageTags={can("people.tags.manage")}
          canManageGroups={can("people.groups.manage") || can("groups.manage")}
          canPipelineView={can("pipeline.view")}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}
