"use client";

/**
 * People CRM v2 — shared types, column registry and per-user view preferences.
 * Prefs piggyback on the additive `peopleCrm` key of User.preferences
 * (POST /users/me/preferences merges them without touching other keys).
 */

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
      const cols = src.columns.filter((c): c is string => typeof c === "string" && VALID_COLUMNS.has(c));
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
