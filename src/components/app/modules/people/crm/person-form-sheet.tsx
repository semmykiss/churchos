"use client";

/**
 * People CRM (Phase 6) — the ONE add/edit person form, as a slide-over.
 *
 * Progressive disclosure: Quick add (name, phone, stage, source) + collapsible
 * "Add more details" (Basic · Contact · Address · Family · Church life ·
 * Custom fields · Consent). A "New visitor" mode narrows the same form to
 * name + phone.
 *
 * EXTENDED, not rebuilt — everything rides the existing server contract:
 *   • POST /people keeps its duplicate response ({duplicates|created}) + force
 *     flow, so the live duplicate detection behaves exactly as before; the
 *     card now offers "Open / Merge / Add anyway".
 *   • E.164: phone auto-normalizes via src/lib/phone (server re-derives).
 *   • DOB with unknown year → month/day in the anchor year (1904) +
 *     birthdateYearKnown=false (server-enforced storage rule).
 *   • Minors require ≥1 guardian (server 422 needs_guardian — hard block).
 *   • Custom values are validated SERVER-side against the definitions; the
 *     form only shows fields the viewer's roles may edit.
 *   • Consents captured on the intake form post through the same create call.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ExternalLink, GitMerge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PersonAvatar, useApiQuery } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { normalizeToE164, formatPhoneDisplay } from "@/lib/phone";
import {
  LIFECYCLE_STAGES, STAGE_LABELS, HOUSEHOLD_ROLES, HOUSEHOLD_ROLE_LABELS, ageOf,
} from "@/lib/types";
import { GuardianMultiSelect } from "../GuardianMultiSelect";
import { HouseholdCombobox } from "../HouseholdCombobox";
import { PersonCombobox } from "../person-search";
import {
  CONSENT_CHANNELS, CONSENT_SOURCES, SOURCE_OPTIONS,
  type CustomFieldDefDTO, type PersonProfile,
} from "./crm-shared";

/** Mirrors BIRTHDATE_ANCHOR_YEAR on the server (people.ts). */
const ANCHOR_YEAR = 1904;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Dup {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  phoneDisplay?: string | null;
  birthdate?: string | null;
  lifecycleStage?: string;
}
interface CreatePersonResponse {
  duplicates: { exact: Dup[]; fuzzy: Dup[] } | null;
  created: { id: string; name: string } | null;
}

export type PersonFormMode = "add" | "edit" | "visitor";

export interface PersonFormPrefill {
  lastName?: string;
  householdMode?: "none" | "existing" | "new";
  householdId?: string;
  newHousehold?: { name?: string; addressLine1?: string };
}

export interface PersonFormSheetProps {
  open: boolean;
  mode: PersonFormMode;
  editPersonId?: string | null;
  /** "Save and add family member" carry-over (surname/household/address). */
  prefill?: PersonFormPrefill | null;
  customFields: CustomFieldDefDTO[];
  /** Viewer role keys — custom fields with editableByRoles are filtered. */
  viewerRoleKeys: string[];
  onClose: () => void;
  /** Called after EVERY successful save (refresh hook); the sheet may stay open. */
  onSaved: (person: { id: string; name: string }) => void;
  /** Duplicate card "Open" — navigate to the existing person. */
  onOpenPerson?: (personId: string) => void;
  /** Duplicate card "Merge" — parent opens the merge flow with this id preset. */
  onMergeRequested?: (duplicateId: string) => void;
}

const pad2 = (n: number | string) => String(n).padStart(2, "0");

function daysInMonth(month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 31;
  return new Date(ANCHOR_YEAR, month, 0).getDate(); // 1904 is a leap year
}

/** One "Add more details" section — consistent card + heading. */
function FieldSection({ title, children, className }: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 rounded-lg border p-3", className)} aria-label={title}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

/** Custom-field input by data type (server re-validates everything). */
function CustomFieldInput({ def, value, onChange, idPrefix }: {
  def: CustomFieldDefDTO;
  value: unknown;
  onChange: (v: unknown) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${def.key}`;
  switch (def.dataType) {
    case "long_text":
      return (
        <Textarea
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={5000}
        />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={String(value ?? "").slice(0, 10)}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "boolean":
      return (
        <Select
          value={value === true ? "true" : value === false ? "false" : ""}
          onValueChange={(v) => onChange(v === "" ? null : v === "true")}
        >
          <SelectTrigger id={id}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      );
    case "select":
      return (
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v === "" ? null : v)}>
          <SelectTrigger id={id}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {def.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "multi_select": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={def.label}>
          {def.options.map((o) => {
            const checked = arr.includes(o);
            return (
              <label
                key={o}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  checked ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => onChange(checked ? arr.filter((v) => v !== o) : [...arr, o])} />
                {o}
              </label>
            );
          })}
        </div>
      );
    }
    default: // text + url
      return (
        <Input
          id={id}
          type={def.dataType === "url" ? "url" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          placeholder={def.dataType === "url" ? "https://…" : undefined}
          maxLength={500}
        />
      );
  }
}

export function PersonFormSheet({
  open, mode, editPersonId, prefill, customFields, viewerRoleKeys,
  onClose, onSaved, onOpenPerson, onMergeRequested,
}: PersonFormSheetProps) {
  const qc = useQueryClient();
  const isEdit = mode === "edit";

  // ── identity / quick add ──
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState(prefill?.lastName ?? "");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("guest");
  const [source, setSource] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [title, setTitle] = useState("");

  // ── basic ──
  const [gender, setGender] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [yearKnown, setYearKnown] = useState(true);
  const [birthdate, setBirthdate] = useState("");
  const [bdMonth, setBdMonth] = useState("");
  const [bdDay, setBdDay] = useState("");
  const [occupation, setOccupation] = useState("");
  const [employer, setEmployer] = useState("");

  // ── contact ──
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("");

  // ── address ──
  const [stateRegion, setStateRegion] = useState("");
  const [lga, setLga] = useState("");

  // ── family ──
  const [householdMode, setHouseholdMode] = useState<"none" | "existing" | "new">("none");
  const [household, setHousehold] = useState<{ id: string; name: string } | null>(null);
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [newHouseholdAddress, setNewHouseholdAddress] = useState("");
  const [householdRole, setHouseholdRole] = useState("adult");
  const [guardianIds, setGuardianIds] = useState<string[]>([]);

  // ── church life ──
  const [homeCampusId, setHomeCampusId] = useState("");
  const [membershipDate, setMembershipDate] = useState("");
  const [salvationDate, setSalvationDate] = useState("");
  const [baptismDate, setBaptismDate] = useState("");
  const [invitedById, setInvitedById] = useState<string | null>(null);
  const [shepherdId, setShepherdId] = useState<string | null>(null);
  const [allergies, setAllergies] = useState("");
  const [notes, setNotes] = useState("");

  // ── custom fields ──
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [customTouched, setCustomTouched] = useState<Set<string>>(new Set());

  // ── consent (intake) ──
  const [consentChannels, setConsentChannels] = useState<Set<string>>(new Set());
  const [consentSource, setConsentSource] = useState("connection_card");

  // ── flow state ──
  const [duplicates, setDuplicates] = useState<{ exact: Dup[]; fuzzy: Dup[] } | null>(null);
  const [needsForce, setNeedsForce] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [afterSave, setAfterSave] = useState<"close" | "another" | "family">("close");
  const [stageChangedTo, setStageChangedTo] = useState<string | null>(null);

  // edit mode: hydrate once the scoped profile arrives
  const profileQ = useApiQuery<PersonProfile>(
    ["people", "v2", "profile", editPersonId ?? ""],
    `/people/v2/${editPersonId}/profile`,
    { enabled: open && isEdit && Boolean(editPersonId) }
  );
  const profile = profileQ.data;
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!isEdit || !profile || hydratedFor === profile.person.id) return;
    const p = profile.person;
    setFirstName(p.firstName ?? "");
    setLastName(p.lastName ?? "");
    setPreferredName(p.preferredName ?? "");
    setPhone(p.phoneDisplay ?? p.phone ?? "");
    setStage(p.lifecycleStage ?? "guest");
    setSource(p.source ?? "");
    setPreferredName(p.preferredName ?? "");
    setTitle(p.title ?? "");
    setGender(p.gender ?? "");
    setMaritalStatus(p.maritalStatus ?? "");
    setOccupation(p.occupation ?? "");
    setEmployer(p.employer ?? "");
    setEmail(p.email ?? "");
    setWhatsapp(p.whatsappDisplay ?? "");
    setPreferredChannel(p.preferredChannel ?? "");
    setStateRegion(p.state ?? "");
    setLga(p.lga ?? "");
    const yk = p.birthdateYearKnown !== false;
    setYearKnown(yk);
    if (p.birthdate) {
      if (yk) setBirthdate(p.birthdate.slice(0, 10));
      else {
        const d = new Date(p.birthdate);
        setBdMonth(String(d.getUTCMonth() + 1));
        setBdDay(String(d.getUTCDate()));
      }
    }
    setHomeCampusId(p.campusId ?? "");
    setMembershipDate(p.membershipDate ? p.membershipDate.slice(0, 10) : "");
    setSalvationDate(p.salvationDate ? p.salvationDate.slice(0, 10) : "");
    setBaptismDate(p.baptismDate ? p.baptismDate.slice(0, 10) : "");
    setInvitedById(p.invitedBy?.id ?? null);
    setShepherdId(p.assignedShepherd?.id ?? null);
    setAllergies(p.allergies ?? "");
    setNotes(p.notes ?? "");
    setCustomValues(profile.customFields ? { ...profile.customFields } : {});
    setHydratedFor(p.id);
  }, [isEdit, profile, hydratedFor]);

  // prefill carry-over ("Save and add family member")
  useEffect(() => {
    if (isEdit || !open || !prefill) return;
    if (prefill.lastName) setLastName(prefill.lastName);
    if (prefill.householdMode) setHouseholdMode(prefill.householdMode);
    if (prefill.householdId) {
      setHousehold({ id: prefill.householdId, name: prefill.newHousehold?.name ?? "Selected household" });
    }
    if (prefill.newHousehold?.name) setNewHouseholdName(prefill.newHousehold.name);
    if (prefill.newHousehold?.addressLine1) setNewHouseholdAddress(prefill.newHousehold.addressLine1);
  }, [open, isEdit, prefill]);

  // reset everything on mode switch (defensive — parents also remount via key)
  const resetKey = `${mode}-${editPersonId ?? "new"}-${open ? "open" : "closed"}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  useEffect(() => {
    if (lastResetKey === resetKey) return;
    setLastResetKey(resetKey);
    setDuplicates(null);
    setNeedsForce(false);
    setForce(false);
    setError(null);
    setStageChangedTo(null);
    if (!isEdit) {
      setFirstName(""); setLastName(prefill?.lastName ?? ""); setPhone("");
      setStage(mode === "visitor" ? "guest" : "guest");
      setSource(mode === "visitor" ? "guest_card" : "");
      setDetailsOpen(false);
    }
  }, [resetKey]);

  const phoneE164 = useMemo(() => normalizeToE164(phone), [phone]);
  const whatsappE164 = useMemo(() => normalizeToE164(whatsapp), [whatsapp]);

  const computedBirthdate = yearKnown
    ? (birthdate || null)
    : bdMonth && bdDay
      ? `${ANCHOR_YEAR}-${pad2(Number(bdMonth))}-${pad2(Number(bdDay))}`
      : null;

  const roleMinor = householdRole === "child" || householdRole === "dependent";
  const age = yearKnown ? ageOf(computedBirthdate) : null;
  const isMinor = roleMinor || (age != null && age < 18);

  // custom fields the viewer's roles may WRITE (server re-checks + validates)
  const editableDefs = useMemo(
    () =>
      customFields.filter(
        (f) => !f.archivedAt && (f.editableByRoles.length === 0 || f.editableByRoles.some((r) => viewerRoleKeys.includes(r)))
      ),
    [customFields, viewerRoleKeys]
  );

  function setCustom(key: string, value: unknown) {
    setCustomValues((prev) => ({ ...prev, [key]: value }));
    setCustomTouched((prev) => new Set(prev).add(key));
  }

  function resetAll(carry?: PersonFormPrefill | null) {
    setFirstName(""); setLastName(carry?.lastName ?? ""); setPhone("");
    setStage("guest"); setSource(""); setPreferredName(""); setTitle("");
    setGender(""); setMaritalStatus(""); setYearKnown(true); setBirthdate("");
    setBdMonth(""); setBdDay(""); setOccupation(""); setEmployer("");
    setEmail(""); setWhatsapp(""); setPreferredChannel("");
    setStateRegion(""); setLga("");
    setHouseholdMode(carry?.householdMode ?? "none");
    setHousehold(carry?.householdId ? { id: carry.householdId, name: "Selected household" } : null);
    setNewHouseholdName(carry?.newHousehold?.name ?? "");
    setNewHouseholdAddress(carry?.newHousehold?.addressLine1 ?? "");
    setHouseholdRole("adult");
    setGuardianIds([]);
    setHomeCampusId(""); setMembershipDate(""); setSalvationDate(""); setBaptismDate("");
    setInvitedById(null); setShepherdId(null); setAllergies(""); setNotes("");
    setCustomValues({}); setCustomTouched(new Set());
    setConsentChannels(new Set()); setConsentSource("connection_card");
    setDuplicates(null); setNeedsForce(false); setForce(false); setError(null);
    setDetailsOpen(false);
    setAfterSave("close");
  }

  function buildCreatePayload(withForce: boolean) {
    const customOut: Record<string, unknown> = {};
    for (const k of customTouched) customOut[k] = customValues[k] ?? null;
    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      preferredName: preferredName.trim() || undefined,
      email: email.trim() || undefined,
      // auto-format to E.164 when parseable; raw falls through (legacy contract)
      phone: phoneE164 ?? (phone.trim() || undefined),
      whatsapp: whatsappE164 ?? (whatsapp.trim() || undefined),
      birthdate: computedBirthdate ?? undefined,
      birthdateYearKnown: computedBirthdate ? yearKnown : undefined,
      gender: gender || undefined,
      lifecycleStage: mode === "visitor" ? "guest" : stage,
      source: mode === "visitor" ? "guest_card" : source || undefined,
      title: title.trim() || undefined,
      maritalStatus: maritalStatus || undefined,
      occupation: occupation.trim() || undefined,
      employer: employer.trim() || undefined,
      preferredChannel: preferredChannel || undefined,
      state: stateRegion.trim() || undefined,
      lga: lga.trim() || undefined,
      homeCampusId: homeCampusId || undefined,
      membershipDate: membershipDate || undefined,
      salvationDate: salvationDate || undefined,
      baptismDate: baptismDate || undefined,
      invitedByPersonId: invitedById ?? undefined,
      assignedShepherdId: shepherdId ?? undefined,
      allergies: allergies.trim() || undefined,
      notes: notes.trim() || undefined,
      householdMode,
      householdId: householdMode === "existing" ? household?.id : undefined,
      newHousehold:
        householdMode === "new"
          ? { name: newHouseholdName.trim(), addressLine1: newHouseholdAddress.trim() || undefined }
          : undefined,
      householdRole: householdMode === "none" ? undefined : householdRole,
      guardians: guardianIds.map((id) => ({ guardianId: id })),
      custom: Object.keys(customOut).length > 0 ? customOut : undefined,
      consents:
        mode === "add" && consentChannels.size > 0
          ? [...consentChannels].map((channel) => ({ channel, status: "granted", source: consentSource || undefined }))
          : undefined,
      force: withForce || undefined,
    };
  }

  async function submitCreate(withForce: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CreatePersonResponse>("/people", buildCreatePayload(withForce));
      if (res.created) {
        toast.success(`Created ${res.created.name}`);
        onSaved(res.created);
        if (afterSave === "another") {
          resetAll(null);
        } else if (afterSave === "family") {
          const carry: PersonFormPrefill = {
            lastName: lastName.trim() || undefined,
            householdMode,
            householdId: householdMode === "existing" ? household?.id : undefined,
            newHousehold:
              householdMode === "new"
                ? { name: newHouseholdName.trim() || undefined, addressLine1: newHouseholdAddress.trim() || undefined }
                : undefined,
          };
          resetAll(carry);
          toast.message("Ready for the next family member", {
            description: [carry.lastName ? `Surname ${carry.lastName}` : null, carry.newHousehold?.name ?? (carry.householdId ? "Same household" : null)]
              .filter(Boolean)
              .join(" · ") || "Household fields carried over",
          });
        } else {
          onClose();
        }
        return;
      }
      if (res.duplicates) {
        setDuplicates(res.duplicates);
        setNeedsForce(false);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const det = (err.details ?? {}) as { needsForce?: boolean; needsGuardian?: boolean };
        if (det.needsGuardian) setError("Minors must have at least one linked guardian.");
        else if (det.needsForce) setNeedsForce(true);
        else setError(err.message);
      } else {
        setError("Could not create person.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!editPersonId) return;
    setBusy(true);
    setError(null);
    try {
      const customOut: Record<string, unknown> = {};
      for (const k of customTouched) customOut[k] = customValues[k] ?? null;
      await api.put(`/people/${editPersonId}`, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        preferredName: preferredName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phoneE164 ?? (phone.trim() || undefined),
        whatsapp: whatsappE164 ?? (whatsapp.trim() || undefined),
        birthdate: computedBirthdate ?? undefined,
        birthdateYearKnown: computedBirthdate ? yearKnown : undefined,
        gender: gender || undefined,
        title: title.trim() || undefined,
        maritalStatus: maritalStatus || undefined,
        occupation: occupation.trim() || undefined,
        employer: employer.trim() || undefined,
        preferredChannel: preferredChannel || undefined,
        state: stateRegion.trim() || undefined,
        lga: lga.trim() || undefined,
        ...(customOut && Object.keys(customOut).length > 0 ? { custom: customOut } : {}),
      });
      if (stageChangedTo && stageChangedTo !== profile?.person.lifecycleStage) {
        await api.post(`/people/${editPersonId}/stage`, { stage: stageChangedTo });
        setStageChangedTo(null);
      }
      toast.success("Profile updated");
      onSaved({ id: editPersonId, name: `${firstName} ${lastName}`.trim() });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const det = (err.details ?? {}) as { needsGuardian?: boolean };
        setError(det.needsGuardian ? "Minors must have at least one linked guardian." : err.message);
      } else {
        setError("Could not update person.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function recordConsentEdit(channel: string, status: string) {
    if (!editPersonId || !channel || !status) return;
    try {
      await api.post(`/people/v2/${editPersonId}/consents`, {
        channel,
        status,
        source: consentSource || undefined,
      });
      toast.success(`Consent recorded — ${channel}`);
      setConsentChannels(new Set());
      void qc.invalidateQueries({ queryKey: ["people", "v2", "profile", editPersonId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record consent.");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) void submitEdit();
    else void submitCreate(force);
  }

  const dupCount = (duplicates?.exact.length ?? 0) + (duplicates?.fuzzy.length ?? 0);
  const quickFields = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pfs-first">First name *</Label>
          <Input id="pfs-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pfs-last">Last name *</Label>
          <Input id="pfs-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pfs-phone">Phone {mode === "visitor" ? "*" : ""}</Label>
        <Input
          id="pfs-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0803 123 4567 · 8031234567 · +234…"
          required={mode === "visitor"}
        />
        {phone.trim() ? (
          phoneE164 ? (
            <p className="text-[11px] text-muted-foreground">
              Saved as <span className="font-medium">{phoneE164}</span>
              {formatPhoneDisplay(phoneE164) ? ` · shows as ${formatPhoneDisplay(phoneE164)}` : ""}
            </p>
          ) : (
            <p className="text-[11px] text-destructive">Not a parseable Nigerian or international number — it will be stored as typed.</p>
          )
        ) : null}
      </div>
      {mode === "add" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pfs-stage">Lifecycle stage</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger id="pfs-stage" aria-label="Lifecycle stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABELS[s] ?? s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-source">Source</Label>
            <Select value={source || undefined} onValueChange={setSource}>
              <SelectTrigger id="pfs-source" aria-label="Source"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </>
  );

  const detailSections = (
    <>
      <FieldSection title="Basic">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pfs-title">Title</Label>
            <Input id="pfs-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mr / Mrs / Dr…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-preferred">Preferred name</Label>
            <Input id="pfs-preferred" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-gender">Gender</Label>
            <Select value={gender || undefined} onValueChange={setGender}>
              <SelectTrigger id="pfs-gender" aria-label="Gender"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="m">Male</SelectItem>
                <SelectItem value="f">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-marital">Marital status</Label>
            <Select value={maritalStatus || undefined} onValueChange={setMaritalStatus}>
              <SelectTrigger id="pfs-marital" aria-label="Marital status"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {["single", "engaged", "married", "widowed", "divorced", "separated"].map((v) => (
                  <SelectItem key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2 rounded-md border p-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="pfs-birthdate" className="text-xs font-semibold">Date of birth</Label>
            <div className="flex items-center gap-2">
              <Switch id="pfs-year-unknown" checked={!yearKnown} onCheckedChange={(v) => setYearKnown(!v)} />
              <Label htmlFor="pfs-year-unknown" className="text-xs font-normal text-muted-foreground">Year unknown</Label>
            </div>
          </div>
          {yearKnown ? (
            <Input id="pfs-birthdate" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} aria-label="Date of birth" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="pfs-bd-month" className="text-[11px] text-muted-foreground">Month</Label>
                <Select value={bdMonth} onValueChange={(v) => { setBdMonth(v); if (Number(v) !== 2 || Number(bdDay) > 29) setBdDay((d) => (Number(v) === 2 && Number(d) > 29 ? "" : d)); }}>
                  <SelectTrigger id="pfs-bd-month" aria-label="Birth month"><SelectValue placeholder="Month" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pfs-bd-day" className="text-[11px] text-muted-foreground">Day</Label>
                <Select value={bdDay} onValueChange={setBdDay}>
                  <SelectTrigger id="pfs-bd-day" aria-label="Birth day"><SelectValue placeholder="Day" /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: daysInMonth(Number(bdMonth) || 1) }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {!yearKnown ? (
            <p className="text-[11px] text-muted-foreground">
              Birthdays and birthday filters still work — the age is simply hidden until a year is known.
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pfs-occupation">Occupation</Label>
            <Input id="pfs-occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-employer">Employer</Label>
            <Input id="pfs-employer" value={employer} onChange={(e) => setEmployer(e.target.value)} />
          </div>
        </div>
      </FieldSection>

      <FieldSection title="Contact">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pfs-email">Email</Label>
            <Input id="pfs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-whatsapp">WhatsApp number</Label>
            <Input id="pfs-whatsapp" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="Leave empty to use phone" />
            {whatsapp.trim() && whatsappE164 ? (
              <p className="text-[11px] text-muted-foreground">Saved as {whatsappE164}</p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pfs-channel">Preferred channel</Label>
          <Select value={preferredChannel || undefined} onValueChange={setPreferredChannel}>
            <SelectTrigger id="pfs-channel" aria-label="Preferred channel"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {["sms", "email", "whatsapp", "call", "any"].map((v) => (
                <SelectItem key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FieldSection>

      <FieldSection title="Address">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pfs-state">State</Label>
            <Input id="pfs-state" value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} placeholder="e.g. Lagos" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-lga">LGA</Label>
            <Input id="pfs-lga" value={lga} onChange={(e) => setLga(e.target.value)} placeholder="Local Government Area" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Street address lives on the household (Family section).</p>
      </FieldSection>

      {mode !== "visitor" ? (
        <FieldSection title="Family">
          <div className="space-y-2">
            <Label>Household</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Household option">
              {([
                ["none", "No household yet"],
                ["existing", "Add to existing"],
                ["new", "Create new"],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={householdMode === v}
                  onClick={() => setHouseholdMode(v)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    householdMode === v ? "border-primary bg-primary/10" : "hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {householdMode === "existing" ? (
              <div className="space-y-2">
                <HouseholdCombobox value={household} onSelect={setHousehold} />
                <div className="space-y-1.5">
                  <Label htmlFor="pfs-hh-role">Role in household</Label>
                  <Select value={householdRole} onValueChange={setHouseholdRole}>
                    <SelectTrigger id="pfs-hh-role" aria-label="Role in household"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOUSEHOLD_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{HOUSEHOLD_ROLE_LABELS[r] ?? r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
            {householdMode === "new" ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pfs-hh-name">Household name *</Label>
                  <Input id="pfs-hh-name" value={newHouseholdName} onChange={(e) => setNewHouseholdName(e.target.value)} placeholder="e.g. The Adeyemi Family" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pfs-hh-address">Address (optional)</Label>
                  <Input id="pfs-hh-address" value={newHouseholdAddress} onChange={(e) => setNewHouseholdAddress(e.target.value)} placeholder="Street address" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pfs-hh-role-new">Role in household</Label>
                  <Select value={householdRole} onValueChange={setHouseholdRole}>
                    <SelectTrigger id="pfs-hh-role-new" aria-label="Role in household"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOUSEHOLD_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{HOUSEHOLD_ROLE_LABELS[r] ?? r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </div>
          {isMinor ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="font-medium text-amber-900 dark:text-amber-200">Guardian required</p>
              <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/70">
                This person is a minor. Link at least one guardian — check-in and pickup authorization depend on it.
              </p>
              <div className="mt-2">
                <GuardianMultiSelect value={guardianIds} onChange={setGuardianIds} excludePersonIds={editPersonId ? [editPersonId] : undefined} />
              </div>
              {guardianIds.length === 0 ? (
                <p className="mt-1.5 text-xs font-medium text-destructive">
                  Required — minors must have at least one linked guardian.
                </p>
              ) : null}
            </div>
          ) : null}
        </FieldSection>
      ) : null}

      {mode !== "visitor" ? (
        <FieldSection title="Church life">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pfs-campus">Home campus</Label>
              <CampusSelect value={homeCampusId} onChange={setHomeCampusId} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pfs-membership">Membership date</Label>
              <Input id="pfs-membership" type="date" value={membershipDate} onChange={(e) => setMembershipDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pfs-salvation">Salvation date</Label>
              <Input id="pfs-salvation" type="date" value={salvationDate} onChange={(e) => setSalvationDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pfs-baptism">Baptism date</Label>
              <Input id="pfs-baptism" type="date" value={baptismDate} onChange={(e) => setBaptismDate(e.target.value)} />
            </div>
          </div>
          {isEdit ? (
            <div className="space-y-1.5">
              <Label htmlFor="pfs-stage-edit">Lifecycle stage</Label>
              <Select value={stageChangedTo ?? stage} onValueChange={setStageChangedTo}>
                <SelectTrigger id="pfs-stage-edit" aria-label="Lifecycle stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIFECYCLE_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Stage changes are recorded in the journey history.</p>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Invited by</Label>
              <PersonCombobox value={invitedById} onSelect={(p) => setInvitedById(p?.id ?? null)} placeholder="Search person…" />
            </div>
            <div className="space-y-1.5">
              <Label>Assigned shepherd</Label>
              <PersonCombobox value={shepherdId} onSelect={(p) => setShepherdId(p?.id ?? null)} placeholder="Search person…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-allergies">Allergies (check-in safety)</Label>
            <Input id="pfs-allergies" value={allergies} onChange={(e) => setAllergies(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfs-notes">Staff notes</Label>
            <Textarea id="pfs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </div>
        </FieldSection>
      ) : null}

      {editableDefs.length > 0 ? (
        <FieldSection title="Custom fields">
          {editableDefs.map((def) => (
            <div key={def.key} className="space-y-1.5">
              <Label htmlFor={`pfs-cf-${def.key}`}>
                {def.label}
                {def.required ? <span className="text-destructive"> *</span> : null}
                {def.pii ? <Badge variant="outline" className="ml-1.5 text-[9px]">PII</Badge> : null}
              </Label>
              <CustomFieldInput
                def={def}
                idPrefix="pfs-cf"
                value={customValues[def.key] ?? (def.dataType === "multi_select" ? [] : "")}
                onChange={(v) => setCustom(def.key, v)}
              />
            </div>
          ))}
        </FieldSection>
      ) : null}

      {mode !== "visitor" ? (
        <FieldSection title="Consent">
          {isEdit ? (
            profile?.consents ? (
              <ConsentChips current={profile.consents.current} />
            ) : null
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Tick what this person consented to (recorded with you as the trail's author):</p>
              <div className="flex flex-wrap gap-1.5">
                {CONSENT_CHANNELS.map((c) => {
                  const checked = consentChannels.has(c.value);
                  return (
                    <label
                      key={c.value}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        checked ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          setConsentChannels((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.value)) next.delete(c.value);
                            else next.add(c.value);
                            return next;
                          });
                        }}
                      />
                      {c.label}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pfs-consent-source">Consent evidence</Label>
            <Select value={consentSource || undefined} onValueChange={setConsentSource}>
              <SelectTrigger id="pfs-consent-source" aria-label="Consent source"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {CONSENT_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isEdit ? (
            <EditConsentRecorder
              disabled={busy}
              onRecord={(channel, status) => void recordConsentEdit(channel, status)}
            />
          ) : null}
        </FieldSection>
      ) : null}
    </>
  );

  const sheetTitle = isEdit
    ? `Edit ${profile?.person.firstName ?? "person"}`
    : mode === "visitor"
      ? "New visitor"
      : "Add person";
  const sheetDesc =
    mode === "visitor"
      ? "Just a name and phone — follow up later from their profile."
      : isEdit
        ? "Changes save straight to the record; the server checks every field."
        : "Start with the essentials — open “Add more details” for everything else.";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription>{sheetDesc}</SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 scroll-slim">
            {quickFields}

            {!isEdit ? (
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between" aria-expanded={detailsOpen}>
                    Add more details
                    <ChevronDown className={cn("h-4 w-4 transition-transform", detailsOpen && "rotate-180")} aria-hidden />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">{detailSections}</CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="space-y-3">{detailSections}</div>
            )}

            {needsForce ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <p className="font-medium text-amber-900 dark:text-amber-200">No contact info — confirm to create.</p>
                <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
                  Without an email or phone there is no way to follow up later. You can add contact info afterwards.
                </p>
              </div>
            ) : null}

            {duplicates ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <p className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  This looks like {dupCount === 1 ? "an existing person" : `${dupCount} existing people`}
                </p>
                <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto scroll-slim">
                  {[...duplicates.exact.map((d) => ({ d, kind: "Exact match" })), ...duplicates.fuzzy.map((d) => ({ d, kind: "Similar" }))].map(
                    ({ d, kind }) => (
                      <li key={`${kind}-${d.id}`} className="flex flex-wrap items-center gap-2 rounded-md bg-background/70 px-2 py-1.5">
                        <PersonAvatar name={d.name} className="h-6 w-6 text-[9px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{d.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[d.email, d.phoneDisplay ?? d.phone].filter(Boolean).join(" · ") || "No contact info"}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px]">{kind}</Badge>
                        {onOpenPerson ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-[11px]"
                            onClick={() => { onOpenPerson(d.id); onClose(); }}
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden /> Open
                          </Button>
                        ) : null}
                        {onMergeRequested ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-[11px]"
                            onClick={() => { onMergeRequested(d.id); onClose(); }}
                          >
                            <GitMerge className="h-3 w-3" aria-hidden /> Merge
                          </Button>
                        ) : null}
                      </li>
                    ),
                  )}
                </ul>
                <div className="mt-3 flex items-center gap-2">
                  <Switch id="pfs-create-anyway" checked={force} onCheckedChange={setForce} />
                  <Label htmlFor="pfs-create-anyway" className="text-xs font-normal text-amber-900 dark:text-amber-200">
                    Add anyway — this is a different person
                  </Label>
                </div>
              </div>
            ) : null}

            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          </div>

          <SheetFooter className="flex-wrap gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            {needsForce ? (
              <Button type="button" disabled={busy || (isMinor && guardianIds.length === 0)} onClick={() => void submitCreate(true)}>
                {busy ? "Saving…" : "Confirm — create without contact info"}
              </Button>
            ) : duplicates ? (
              <Button type="submit" disabled={busy || !force || (isMinor && guardianIds.length === 0)}>
                {busy ? "Saving…" : "Add anyway"}
              </Button>
            ) : isEdit ? (
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {mode === "add" ? (
                  <>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={busy || (isMinor && guardianIds.length === 0)}
                      onClick={() => setAfterSave("family")}
                    >
                      Save and add family member
                    </Button>
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={busy || (isMinor && guardianIds.length === 0)}
                      onClick={() => setAfterSave("another")}
                    >
                      Save and add another
                    </Button>
                  </>
                ) : null}
                <Button type="submit" disabled={busy || (isMinor && guardianIds.length === 0)}>
                  {busy ? "Saving…" : mode === "visitor" ? "Add visitor" : "Save person"}
                </Button>
              </div>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Current per-channel consent chips (edit mode summary). */
function ConsentChips({ current }: { current: Record<string, string> }) {
  const entries = Object.entries(current);
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No consent recorded yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Current consent status">
      {entries.map(([channel, status]) => (
        <Badge key={channel} variant={status === "granted" ? "secondary" : "outline"} className="text-[11px] font-normal">
          {channel}: {status}
        </Badge>
      ))}
    </div>
  );
}

/** Edit mode — record a new consent event straight from the form. */
function EditConsentRecorder({ disabled, onRecord }: {
  disabled: boolean;
  onRecord: (channel: string, status: string) => void;
}) {
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("granted");
  return (
    <div className="space-y-2 rounded-md border p-2.5">
      <p className="text-xs font-medium">Record a consent event</p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={channel || undefined} onValueChange={setChannel}>
          <SelectTrigger aria-label="Consent channel" className="h-8 text-xs"><SelectValue placeholder="Channel" /></SelectTrigger>
          <SelectContent>
            {CONSENT_CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Consent status" className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="granted">Granted</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="withdrawn">Withdrawn</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8"
        disabled={disabled || !channel}
        onClick={() => { onRecord(channel, status); setChannel(""); }}
      >
        Record consent
      </Button>
    </div>
  );
}

/** Campus options for the Church life section (shared options endpoint). */
function CampusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const optsQ = useApiQuery<{ campuses: { id: string; name: string }[] }>(
    ["people", "v2", "options"],
    "/people/v2/options"
  );
  const campuses = optsQ.data?.campuses ?? [];
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v === "" ? "" : v)}>
      <SelectTrigger id="pfs-campus" aria-label="Home campus"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
