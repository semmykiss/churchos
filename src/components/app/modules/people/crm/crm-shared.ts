"use client";

/**
 * People CRM v2 — shared types, column registry and per-user view preferences.
 * Prefs piggyback on the additive `peopleCrm` key of User.preferences
 * (POST /users/me/preferences merges them without touching other keys).
 */
import { fmtDate } from "@/lib/types";

// ── API row / response shapes (additive over the Phase 1 serializer) ─────────

export interface CrmHouseholdMember {
  personId: string;
  name: string;
  photoUrl: string | null;
  role: string;
}

export interface CrmPersonRow {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  phoneDisplay: string | null;
  whatsappE164: string | null;
  birthdate: string | null;
  gender: string | null;
  status: string;
  lifecycleStage: string;
  membershipStatus: string;
  photoUrl: string | null;
  viewerTier: string;
  privacyHidden: string[];
  household: { id: string; name: string; role: string } | null;
  tags: { id: string; name: string; color: string }[];
  // v2-only
  age: number | null;
  campusId: string | null;
  campusName: string | null;
  groups: { id: string; name: string }[];
  householdMembers: CrmHouseholdMember[];
  householdMemberCount: number;
  lastAttendedAt: string | null;
  // Phase 6 — role-filtered custom field values (keys the viewer cannot see
  // are OMITTED by the server) + year-unknown birthdate flag
  custom?: Record<string, unknown>;
  birthdateYearKnown?: boolean;
}

export interface CrmListResponse {
  items: CrmPersonRow[];
  nextCursor: string | null;
  total: number;
  pageSize: number;
  /** Phase 3: per-stage totals over the same scoped where (board headers). */
  stageCounts?: Record<string, number>;
}

export interface CrmInsights {
  scope: "org" | "relationships";
  stats: {
    totalActive: number;
    newThisMonth: number;
    notSeenIn4Weeks: number;
    notInAnyGroup: number;
    birthdaysThisWeek: number;
  };
  generatedAt: string;
}

// ── filters ──────────────────────────────────────────────────────────────────

export interface FilterCondition {
  field: string;
  op: string;
  value?: unknown;
}

export interface FilterGroup {
  match: "all" | "any";
  conditions: FilterCondition[];
}

// ── saved smart views (Phase 3) ─────────────────────────────────────────────

export type CrmViewMode = "table" | "cards" | "board";

export interface SavedViewSort {
  sort: string;
  dir: "asc" | "desc";
}

export interface SavedViewDTO {
  id: string;
  /** System defaults carry stable "sys:*" keys; DB rows echo their row id. */
  key: string | null;
  name: string;
  description: string | null;
  scope: "system" | "personal" | "shared";
  viewType: CrmViewMode;
  filters: FilterGroup | null;
  columns: string[] | null;
  sort: SavedViewSort | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface BulkFailed {
  id: string;
  name: string;
  reason: string;
}

export interface BulkResult {
  action: string;
  total: number;
  succeeded: number;
  failed: BulkFailed[];
}

// ── Profile 360 (Phase 6) — custom fields + consents ─────────────────────────

export type CustomFieldDataType = "text" | "long_text" | "number" | "date" | "boolean" | "select" | "multi_select" | "url";

export interface CustomFieldDefDTO {
  id: string;
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  options: string[];
  required: boolean;
  searchable: boolean;
  showInList: boolean;
  pii: boolean;
  visibility: string; // staff | leaders | member
  visibleToRoles: string[];
  editableByRoles: string[];
  filterable: boolean;
  archivedAt: string | null;
}

export interface ConsentEntryDTO {
  id: string;
  channel: string; // whatsapp | sms | email | call | photo
  status: string; // granted | declined | withdrawn
  source: string | null;
  note: string | null;
  occurredAt: string;
  recordedByName: string | null;
  createdAt: string;
}

export interface ConsentHistoryDTO {
  current: Record<string, string>; // channel → latest status
  items: ConsentEntryDTO[];
}

export const CONSENT_CHANNELS: { value: string; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "call", label: "Phone calls" },
  { value: "photo", label: "Photo use" },
];
export const CONSENT_STATUSES: { value: string; label: string }[] = [
  { value: "granted", label: "Granted" },
  { value: "declined", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
];
export const CONSENT_SOURCES: { value: string; label: string }[] = [
  { value: "connection_card", label: "Connection card" },
  { value: "in_person", label: "In person" },
  { value: "phone_call", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];
export function consentChannelLabel(v: string): string {
  return CONSENT_CHANNELS.find((c) => c.value === v)?.label ?? v;
}
export function consentStatusLabel(v: string): string {
  return CONSENT_STATUSES.find((s) => s.value === v)?.label ?? v;
}
export function customColumnId(key: string): string {
  return `custom:${key}`;
}

/**
 * DOB with an unknown year: the server stores month/day in an anchor year and
 * flips birthdateYearKnown=false — never show an age or a made-up year.
 */
export function birthDateLabel(birthdate: string | null | undefined, yearKnown = true): string | null {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return null;
  const md = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return yearKnown ? fmtDate(birthdate) : `${md} (year unknown)`;
}

// ── Profile 360 (Phase 4) ────────────────────────────────────────────────────
// Shapes mirror GET /people/v2/:id/profile. Gated fields are OMITTED by the
// server (absent keys, not nulls) — the UI renders only what arrived.

export interface ProfileHousehold {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  canEdit: boolean;
  members: {
    personId: string;
    name: string;
    photoUrl: string | null;
    role: string;
    isThisPerson: boolean;
    age: number | null;
  }[];
}

export interface ProfileGuardian {
  personId: string;
  name: string;
  photoUrl: string | null;
  phone: string | null;
  relationshipType: string;
  authorizedPickup: boolean;
  custodyRestricted: boolean;
  isPrimary: boolean;
}

export interface ProfileDependent {
  personId: string;
  name: string;
  photoUrl: string | null;
  age: number | null;
  relationshipType: string;
  isPrimary: boolean;
}

export interface ProfileEmergencyContact {
  personId: string;
  name: string;
  phone: string | null;
  relationshipType: string | null;
}

export interface ProfileMilestone {
  id: string;
  type: string;
  date: string | null;
  notes: string | null;
  certificateUrl: string | null;
  createdAt: string;
}

export interface ProfileStageHistoryEntry {
  stage: string;
  previousStage: string | null;
  changedAt: string;
  changedByName: string | null;
  note: string | null;
}

/** Rule-based (NOT LLM) staff suggestion — deterministic, server-computed. */
export interface NextStepSuggestion {
  id: string;
  title: string;
  reason: string;
}

/** Phase 5 — which profile tabs the server allows this viewer to see.
 * The UI only hides; every sub-endpoint re-enforces the same rule. */
export interface ProfileTabs {
  attendance: boolean;
  giving: boolean;
  notes: boolean;
  /** the Add-note dialog may offer the confidential toggle */
  notesConfidential: boolean;
  comms: boolean;
  activity: boolean;
}

// ── Profile 360 (Phase 5) — per-tab dataset shapes ───────────────────────────

export interface ProfileNote {
  id: string;
  type: string; // General | Call | Visit | Counseling | Prayer
  body: string;
  pinned: boolean;
  confidentialityTier: "standard" | "confidential";
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ProfileAttendance {
  /** "YYYY-MM-DD" (Africa/Lagos calendar) → number of attendances that day */
  daily: Record<string, number>;
  /** "YYYY-MM" → count (streak support) */
  months: Record<string, number>;
  streak: number;
  lastSeenAt: string | null;
  total12m: number;
  recent: {
    id: string;
    eventName: string;
    eventKind: string;
    date: string;
    status: string;
    method: string | null;
    firstTime: boolean;
  }[];
}

export interface ProfileMessageHistory {
  emailSms: {
    id: string;
    channel: string; // email | sms
    subject: string | null;
    messageStatus: string;
    recipientStatus: string;
    sentAt: string | null;
    fromName: string | null;
  }[];
  whatsapp: null | {
    contactId: string;
    phoneNumber: string;
    optedIn: boolean;
    items: {
      id: string;
      direction: string; // in | out
      messageType: string;
      content: string | null;
      status: string;
      createdAt: string;
    }[];
  };
}

export interface ProfileActivityEvent {
  id: string;
  type: "stage" | "milestone" | "attendance" | "group_joined" | "note" | "gift";
  at: string;
  stage?: string;
  previousStage?: string | null;
  changedByName?: string | null;
  milestoneType?: string;
  eventName?: string;
  status?: string;
  groupName?: string;
  role?: string;
  noteType?: string;
  confidential?: boolean;
  excerpt?: string;
  amountCents?: number;
  method?: string;
}

/** Fixed Notes & Care type taxonomy (mirrors the server's NOTE_TYPES). */
export const NOTE_TYPES: { value: string; label: string }[] = [
  { value: "General", label: "General" },
  { value: "Call", label: "Call" },
  { value: "Visit", label: "Visit" },
  { value: "Counseling", label: "Counseling" },
  { value: "Prayer", label: "Prayer" },
];
const NOTE_LABEL_MAP = new Map(NOTE_TYPES.map((t) => [t.value, t.label]));
export function noteTypeLabel(type: string): string {
  return NOTE_LABEL_MAP.get(type) ?? type;
}

export interface PersonProfile {
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    email?: string | null;
    phone?: string | null;
    phoneE164?: string | null;
    phoneDisplay?: string | null;
    whatsappE164?: string | null;
    whatsappDisplay?: string | null;
    birthdate?: string | null;
    gender?: string | null;
    status: string;
    lifecycleStage: string;
    membershipStatus: string;
    photoUrl: string | null;
    firstVisitAt?: string | null;
    lastActivityAt?: string | null;
    // Phase 1 profile extras — omitted for tiers without profile visibility
    title?: string | null;
    maritalStatus?: string | null;
    weddingAnniversary?: string | null;
    occupation?: string | null;
    employer?: string | null;
    preferredChannel?: string | null;
    state?: string | null;
    lga?: string | null;
    campusId?: string | null;
    campusName?: string | null;
    membershipDate?: string | null;
    salvationDate?: string | null;
    baptismDate?: string | null;
    source?: string | null;
    lastContactedAt?: string | null;
    invitedBy?: { id: string; name: string; photoUrl: string | null } | null;
    assignedShepherd?: { id: string; name: string; photoUrl: string | null } | null;
    directoryPrivacy?: { phone: boolean; email: boolean; birthday: boolean; address: boolean } | null;
    allergies?: string | null;
    notes?: string | null;
    viewerTier: string;
    privacyHidden: string[];
    // server-computed scoped rights — the single source of truth for the UI
    canEdit: boolean;
    canEditDirectoryPrivacy: boolean;
    createdAt: string;
    // Phase 6
    birthdateYearKnown?: boolean;
  };
  household: ProfileHousehold | null;
  guardians: ProfileGuardian[];
  dependents: ProfileDependent[];
  emergencyContacts?: ProfileEmergencyContact[];
  groups: { id: string; name: string; role: string; meetingDay?: string | null; meetingTime?: string | null }[];
  tags: { id: string; name: string; color: string }[];
  // omitted entirely for tiers without journey visibility
  milestones?: ProfileMilestone[];
  stageHistory?: ProfileStageHistoryEntry[];
  // omitted entirely for non-staff viewers
  nextStep?: NextStepSuggestion | null;
  // Phase 5 — server-computed tab visibility (omitted = legacy cached response)
  tabs?: ProfileTabs;
  // Phase 6 — role-filtered custom values + consent trail (omitted when not permitted)
  customFields?: Record<string, unknown>;
  consents?: ConsentHistoryDTO;
}

/** The fixed Journey milestone taxonomy (mirrors the server's MILESTONE_TYPES). */
export const MILESTONE_TYPES: { value: string; label: string }[] = [
  { value: "salvation", label: "Salvation" },
  { value: "water_baptism", label: "Water baptism" },
  { value: "holy_spirit_baptism", label: "Holy Spirit baptism" },
  { value: "foundation_school", label: "Foundation School" },
  { value: "membership_class", label: "Membership class" },
  { value: "marriage", label: "Marriage" },
  { value: "child_dedication", label: "Child dedication" },
  { value: "workers_training", label: "Workers' training" },
  { value: "leadership_appointment", label: "Leadership appointment" },
];

const MILESTONE_LABEL_MAP = new Map(MILESTONE_TYPES.map((t) => [t.value, t.label]));
export function milestoneLabel(type: string): string {
  return MILESTONE_LABEL_MAP.get(type) ?? type;
}

/** Nigerian source-of-visitor values (mirrors the classic add/edit forms). */
export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "guest_card", label: "Guest card" },
  { value: "referral", label: "Referral" },
  { value: "outreach", label: "Outreach" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "online", label: "Online" },
  { value: "import", label: "Import" },
  { value: "other", label: "Other" },
];
export function sourceLabel(v: string | null | undefined): string {
  return SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v ?? "—";
}

// ── columns ──────────────────────────────────────────────────────────────────

export const CRM_COLUMNS = [
  { id: "name", label: "Name", sortable: true },
  { id: "contact", label: "Contact", sortable: false },
  { id: "household", label: "Household", sortable: false },
  { id: "stage", label: "Stage", sortable: true },
  { id: "groups", label: "Groups", sortable: false },
  { id: "lastSeen", label: "Last seen", sortable: true },
  { id: "age", label: "Age", sortable: true },
  { id: "campus", label: "Campus", sortable: false },
] as const;

export type CrmColumnId = (typeof CRM_COLUMNS)[number]["id"];
export const DEFAULT_COLUMNS: CrmColumnId[] = CRM_COLUMNS.map((c) => c.id);

/** A column id is a core id or "custom:<key>" (Phase 6). */
export function isCustomColumnId(id: string): boolean {
  return id.startsWith("custom:") && /^[a-z0-9_]{1,40}$/.test(id.slice(7));
}

// ── per-user view preferences ────────────────────────────────────────────────

export interface PeopleCrmPrefs {
  view?: "crm" | "classic";
  density?: "default" | "compact";
  columns?: string[];
  /** Phase 3: last-used alternate view (Table | Cards | Board). */
  viewMode?: CrmViewMode;
}

const VALID_COLUMNS = new Set<string>(DEFAULT_COLUMNS);

export function parsePeopleCrmPrefs(preferences?: string | null): PeopleCrmPrefs {
  if (!preferences) return {};
  try {
    const raw = JSON.parse(preferences) as { peopleCrm?: unknown };
    const p = raw?.peopleCrm;
    if (!p || typeof p !== "object") return {};
    const src = p as Record<string, unknown>;
    const out: PeopleCrmPrefs = {};
    if (src.view === "crm" || src.view === "classic") out.view = src.view;
    if (src.density === "default" || src.density === "compact") out.density = src.density;
    if (src.viewMode === "table" || src.viewMode === "cards" || src.viewMode === "board") out.viewMode = src.viewMode;
    if (Array.isArray(src.columns)) {
      const cols = src.columns.filter(
        (c): c is string => typeof c === "string" && (VALID_COLUMNS.has(c) || isCustomColumnId(c))
      );
      if (cols.length > 0) out.columns = cols;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist a pref patch server-side, then refresh the session so `user` updates. */
export async function savePeopleCrmPrefs(patch: Partial<PeopleCrmPrefs>): Promise<void> {
  try {
    const { api } = await import("@/lib/api");
    await api.post("/users/me/preferences", { peopleCrm: patch });
    window.dispatchEvent(new CustomEvent("chms:session-refresh"));
  } catch {
    // preference save is best-effort — the local state already reflects it
  }
}

// ── display helpers ──────────────────────────────────────────────────────────

/** Relative "last seen" text — icon + text carry the meaning (not color alone). */
export function relLastSeen(iso: string | null | undefined): { text: string; days: number | null } {
  if (!iso) return { text: "Never", days: null };
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { text: "Never", days: null };
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return { text: "Today", days: 0 };
  if (days === 1) return { text: "Yesterday", days };
  if (days < 28) return { text: `${days}d ago`, days };
  if (days < 365) return { text: `${Math.floor(days / 7)}w ago`, days };
  return { text: `${Math.floor(days / 365)}y ago`, days };
}

export function waLink(e164: string | null | undefined): string | null {
  if (!e164 || !e164.startsWith("+")) return null;
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

export function fullName(r: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${r.firstName} ${r.lastName}`;
  return r.preferredName ? `${base} (${r.preferredName})` : base;
}

// ── People CRM Phase 7 — import / export / public forms DTOs ─────────────────

export interface ImportFieldIssueDTO {
  field: string;
  raw: string;
  value?: string;
  reason: string;
}

export interface ImportJobStats {
  rows?: number;
  errors?: number;
  duplicates?: number;
  intraFileDuplicates?: number;
  issues?: number;
  stage?: string;
  processed?: number;
  created?: number;
  skipped?: number;
  merged?: number;
  failed?: number;
  committing?: boolean;
  rollback?: { deleted: number; skipped: { row: number; reason: string }[]; at: string };
}

export interface ImportJobDTO {
  id: string;
  fileName: string | null;
  status: string; // staged | committed | rolled_back | failed
  stats: ImportJobStats;
  importBatchId: string | null;
  createdByName: string | null;
  createdAt: string;
  committedAt: string | null;
  rolledBackAt: string | null;
  undoable?: boolean;
}

export interface ImportPreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  values: Record<string, string>;
  issues: ImportFieldIssueDTO[];
  status: string; // ready | error
  errorReason: string | null;
  action: string | null; // create | skip | merge
  duplicateOfId: string | null;
  duplicateScore: number | null;
}

export interface ImportMappingTemplateDTO {
  id: string;
  name: string;
  mapping: string; // JSON column → field
  source: string;
  createdByName: string | null;
  createdAt: string;
}

export interface ExportColumnDTO {
  id: string;
  label: string;
}

export interface ExportLogEntryDTO {
  id: string;
  userName: string;
  format: string;
  rowCount: number;
  columns: string | null;
  filters: string | null;
  createdAt: string;
}

export interface PublicFormFieldDTO {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "phone" | "email" | "date";
  options?: readonly string[];
  enabled: boolean;
  required: boolean;
}

export interface PublicFormDTO {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  fields: { key: string; required: boolean }[];
  thankYouMessage: string | null;
  requireApproval: boolean;
  createdAt: string;
  submissionCounts?: { total: number; pending: number; converted: number; duplicate: number };
}

export interface PublicFormSubmissionDTO {
  id: string;
  formId: string;
  status: string; // pending | approved | rejected | converted | duplicate
  payload: Record<string, string>;
  duplicateOfPersonId: string | null;
  duplicateOfName: string | null;
  convertedPersonId: string | null;
  convertedName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Fixed builder catalog keys (server mirrors FORM_FIELD_CATALOG). */
export const PUBLIC_FORM_CATALOG: { key: string; label: string; type: string; locked?: boolean }[] = [
  { key: "firstName", label: "First name", type: "text", locked: true },
  { key: "lastName", label: "Last name", type: "text", locked: true },
  { key: "phone", label: "Phone number", type: "phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "gender", label: "Gender", type: "select" },
  { key: "birthdate", label: "Date of birth", type: "date" },
  { key: "address", label: "Home address", type: "text" },
  { key: "visitingFrom", label: "How did you hear about us?", type: "text" },
  { key: "interestedIn", label: "I'm interested in…", type: "select" },
  { key: "prayerRequest", label: "Prayer request", type: "textarea" },
];

/** Exportable scalar column catalog (composite CRM columns expand server-side). */
export const EXPORT_COLUMN_CATALOG: ExportColumnDTO[] = [
  { id: "name", label: "Name" },
  { id: "contact", label: "Contact (email + phones)" },
  { id: "firstName", label: "First name" },
  { id: "lastName", label: "Last name" },
  { id: "preferredName", label: "Preferred name" },
  { id: "title", label: "Title" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone (E.164)" },
  { id: "phoneDisplay", label: "Phone (display)" },
  { id: "whatsapp", label: "WhatsApp (E.164)" },
  { id: "gender", label: "Gender" },
  { id: "birthdate", label: "Date of birth" },
  { id: "age", label: "Age" },
  { id: "maritalStatus", label: "Marital status" },
  { id: "weddingAnniversary", label: "Wedding anniversary" },
  { id: "occupation", label: "Occupation" },
  { id: "address", label: "Address" },
  { id: "city", label: "City" },
  { id: "state", label: "State" },
  { id: "lga", label: "LGA" },
  { id: "household", label: "Household" },
  { id: "campus", label: "Campus" },
  { id: "stage", label: "Stage" },
  { id: "status", label: "Member status" },
  { id: "groups", label: "Groups" },
  { id: "tags", label: "Tags" },
  { id: "lastSeen", label: "Last seen" },
  { id: "createdAt", label: "Added on" },
  { id: "notes", label: "Notes" },
];
