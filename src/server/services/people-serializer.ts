/**
 * People CRM — the ONE permission-scoped serializer for people reads.
 *
 * Every people list/detail/household/duplicate/export response is built here
 * so field visibility is decided ONCE, server-side, per (viewer, target) pair.
 * Never query the people table from a new endpoint without going through this
 * module — hiding a field in the UI is not a permission.
 *
 * ── Viewer tiers (resolved from real permissions + relationships) ───────────
 *   staff   — holds "people.edit" (admin/pastor/minister/HOD): full record,
 *             including staff notes; giving stays governed by canSeeGivingOf.
 *   finance — holds "giving.view.all" but NOT "people.edit": full contact +
 *             giving per existing rules, but NEVER confidential notes and
 *             never allergy flags.
 *   self    — viewing their own record: everything except staff notes.
 *   parent  — holds "people.edit.own_household" and the target is their
 *             household member or linked dependent: full access to that
 *             household's records (except staff notes).
 *   leader  — the target is an active member of a group the viewer leads:
 *             contact details + attendance for their group members only,
 *             birthday only if the member opted in; no giving, no notes.
 *   member  — only "people.view": name, photo, groups; phone/email/birthday
 *             ONLY when the target opted in via directoryPrivacy (opt-in,
 *             privacy by default). No address, no attendance, no giving.
 *
 * Directory privacy JSON (opt-in flags): { phone, email, birthday, address }.
 * Missing/null/absent = NOT opted in. Staff tiers ignore privacy flags.
 */
import { db } from "@/server/db";
import { can, type SessionUser } from "@/server/permissions";
import { formatPhoneDisplay, normalizeToE164 } from "@/lib/phone";

export type PersonViewerTier = "staff" | "finance" | "self" | "parent" | "leader" | "member";

// ── directory privacy (member opt-in) ───────────────────────────────────────

export interface DirectoryPrivacy {
  phone: boolean;
  email: boolean;
  birthday: boolean;
  address: boolean;
}

const PRIVACY_KEYS = ["phone", "email", "birthday", "address"] as const;
export type DirectoryPrivacyKey = (typeof PRIVACY_KEYS)[number];

/** Parse the stored JSON — null-safe, unknown keys dropped, absent = false. */
export function parseDirectoryPrivacy(raw: string | null | undefined): DirectoryPrivacy {
  const out: DirectoryPrivacy = { phone: false, email: false, birthday: false, address: false };
  if (!raw) return out;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const k of PRIVACY_KEYS) out[k] = (parsed as Record<string, unknown>)[k] === true;
  return out;
}

/** Canonical storage form — always all four keys, booleans. */
export function serializeDirectoryPrivacy(p: Partial<DirectoryPrivacy> | null | undefined): string {
  const out: Record<string, boolean> = {};
  for (const k of PRIVACY_KEYS) out[k] = p?.[k] === true;
  return JSON.stringify(out);
}

// ── viewer scope (resolved once per request) ────────────────────────────────

export interface ViewerScope {
  user: SessionUser;
  isStaff: boolean;
  isFinance: boolean;
  selfPersonId: string | null;
  /** Households the viewer belongs to (parent scope). */
  householdIds: Set<string>;
  /** People the viewer is a guardian of (parent scope). */
  dependentIds: Set<string>;
  /** Groups the viewer leads or co-leads. */
  ledGroupIds: Set<string>;
  /** Active members of the groups the viewer leads (leader scope). */
  ledGroupMemberIds: Set<string>;
}

/**
 * Resolve the viewer's relationships once per request. Staff skip the
 * relationship queries entirely (they see everything). Cheap, indexed,
 * tenant-scoped — safe to call on every list request.
 */
export async function buildViewerScope(user: SessionUser): Promise<ViewerScope> {
  const isStaff = can(user, "people.edit");
  const isFinance = !isStaff && can(user, "giving.view.all");
  const scope: ViewerScope = {
    user,
    isStaff,
    isFinance,
    selfPersonId: user.personId ?? null,
    householdIds: new Set(),
    dependentIds: new Set(),
    ledGroupIds: new Set(),
    ledGroupMemberIds: new Set(),
  };
  if (!user.personId || isStaff) return scope;

  const [hhLinks, guardianRels, ledMemberships] = await Promise.all([
    db.householdMember.findMany({
      where: { personId: user.personId, endedAt: null, household: { orgId: user.orgId, deletedAt: null } },
      select: { householdId: true },
    }),
    db.personRelationship.findMany({
      where: { orgId: user.orgId, fromPersonId: user.personId, isGuardian: true },
      select: { toPersonId: true },
    }),
    db.groupMember.findMany({
      where: {
        orgId: user.orgId,
        personId: user.personId,
        role: { in: ["leader", "co_leader"] },
        status: "active",
        group: { orgId: user.orgId, deletedAt: null, status: "active" },
      },
      select: { groupId: true },
    }),
  ]);
  scope.householdIds = new Set(hhLinks.map((h) => h.householdId));
  scope.dependentIds = new Set(guardianRels.map((r) => r.toPersonId));
  scope.ledGroupIds = new Set(ledMemberships.map((g) => g.groupId));
  if (scope.ledGroupIds.size > 0) {
    const members = await db.groupMember.findMany({
      where: { orgId: user.orgId, groupId: { in: [...scope.ledGroupIds] }, status: "active" },
      select: { personId: true },
    });
    scope.ledGroupMemberIds = new Set(members.map((m) => m.personId));
  }
  return scope;
}

/**
 * Effective tier for one target row. `householdIds` = the TARGET's household
 * ids (already included on rows; pass [] when unknown).
 */
export function tierForTarget(
  scope: ViewerScope,
  target: { id: string; householdIds?: string[] | Set<string> }
): PersonViewerTier {
  if (scope.isStaff) return "staff";
  if (scope.isFinance) return "finance";
  if (scope.selfPersonId && scope.selfPersonId === target.id) return "self";
  if (can(scope.user, "people.edit.own_household")) {
    const ids = target.householdIds instanceof Set ? target.householdIds : new Set(target.householdIds ?? []);
    for (const h of ids) if (scope.householdIds.has(h)) return "parent";
    if (scope.dependentIds.has(target.id)) return "parent";
  }
  if (scope.ledGroupMemberIds.has(target.id)) return "leader";
  return "member";
}

// ── per-tier field rules ────────────────────────────────────────────────────

interface ContactGates {
  phone: boolean;
  email: boolean;
  birthday: boolean;
}

function contactGatesFor(tier: PersonViewerTier, privacy: DirectoryPrivacy): ContactGates {
  switch (tier) {
    case "staff":
    case "finance":
    case "self":
    case "parent":
      return { phone: true, email: true, birthday: true };
    case "leader":
      // Leaders get contact for their group members; birthday stays opt-in.
      return { phone: true, email: true, birthday: privacy.birthday };
    case "member":
      return { phone: privacy.phone, email: privacy.email, birthday: privacy.birthday };
  }
}

function allergiesVisible(tier: PersonViewerTier): boolean {
  return tier === "staff" || tier === "self" || tier === "parent";
}

/** Household address block (staff/finance/self/parent only). */
export function addressVisible(tier: PersonViewerTier): boolean {
  return tier === "staff" || tier === "finance" || tier === "self" || tier === "parent";
}

/** Staff notes — never leaves the staff tier. */
function notesVisible(tier: PersonViewerTier): boolean {
  return tier === "staff";
}

/** Attendance recency — staff/finance read; leaders only for their members. */
function attendanceVisible(tier: PersonViewerTier): boolean {
  return tier === "staff" || tier === "finance" || tier === "self" || tier === "leader";
}

/** Profile extras (title…lga) + milestone dates + source. */
function profileVisible(tier: PersonViewerTier): boolean {
  return tier === "staff" || tier === "finance" || tier === "self" || tier === "parent";
}

/** Directory privacy JSON itself is visible to the person + their family + staff. */
export function privacyEditableFor(tier: PersonViewerTier): boolean {
  return tier === "staff" || tier === "self" || tier === "parent";
}

// ── row shape accepted by the serializer ────────────────────────────────────

export interface HouseholdLinkLike {
  role: string;
  household: { id: string; name: string; addressLine1?: string | null; city?: string | null; region?: string | null };
}

export interface PersonRowLike {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  phoneE164?: string | null;
  whatsappE164?: string | null;
  birthdate: Date | null;
  gender: string | null;
  status: string;
  lifecycleStage: string;
  membershipStatus: string;
  allergies?: string | null;
  notes?: string | null;
  photoUrl: string | null;
  firstVisitAt: Date | null;
  lastActivityAt: Date | null;
  homeCampusId?: string | null;
  title?: string | null;
  maritalStatus?: string | null;
  weddingAnniversary?: Date | null;
  occupation?: string | null;
  employer?: string | null;
  preferredChannel?: string | null;
  state?: string | null;
  lga?: string | null;
  membershipDate?: Date | null;
  salvationDate?: Date | null;
  baptismDate?: Date | null;
  source?: string | null;
  invitedByPersonId?: string | null;
  assignedShepherdId?: string | null;
  directoryPrivacy?: string | null;
  lastAttendedAt?: Date | null;
  lastContactedAt?: Date | null;
  householdLinks?: HouseholdLinkLike[];
  tags?: Array<{ tag: { id: string; name: string; color: string } }>;
  invitedBy?: { id: string; firstName: string; lastName: string; photoUrl: string | null } | null;
  assignedShepherd?: { id: string; firstName: string; lastName: string; photoUrl: string | null } | null;
}

function displayPhone(p: PersonRowLike): string | null {
  const e164 = p.phoneE164 ?? normalizeToE164(p.phone);
  return formatPhoneDisplay(e164);
}

function targetHouseholdIds(p: PersonRowLike): string[] {
  return (p.householdLinks ?? []).map((l) => l.household.id);
}

/**
 * Core gated person fields — shared by list rows AND the detail `person`
 * object. Every existing key keeps its name/type; Phase 1 fields are
 * ADDITIVE. `viewerTier` + `privacyHidden` let the UI explain WHY a field
 * is empty ("hidden by privacy" vs "not on file").
 */
export function serializePersonCore(scope: ViewerScope, p: PersonRowLike) {
  const tier = tierForTarget(scope, { id: p.id, householdIds: targetHouseholdIds(p) });
  const privacy = parseDirectoryPrivacy(p.directoryPrivacy);
  const contact = contactGatesFor(tier, privacy);
  const showProfile = profileVisible(tier);
  const showAllergies = allergiesVisible(tier);
  const showAttendance = attendanceVisible(tier);
  const showPrivacy = privacyEditableFor(tier);

  const privacyHidden: string[] = [];
  if (!contact.phone) privacyHidden.push("phone");
  if (!contact.email) privacyHidden.push("email");
  if (!contact.birthday) privacyHidden.push("birthday");
  if (!showAttendance) privacyHidden.push("attendance");
  if (!showAllergies) privacyHidden.push("allergies");
  if (!notesVisible(tier)) privacyHidden.push("notes");

  const personRel = (r: PersonRowLike["invitedBy"]) =>
    r ? { id: r.id, name: `${r.firstName} ${r.lastName}`, photoUrl: r.photoUrl } : null;

  return {
    // ── existing contract (unchanged keys) ──
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    email: contact.email ? p.email : null,
    phone: contact.phone ? p.phone : null,
    birthdate: contact.birthday ? p.birthdate : null,
    gender: p.gender,
    status: p.status,
    lifecycleStage: p.lifecycleStage,
    membershipStatus: p.membershipStatus,
    allergies: showAllergies ? (p.allergies ?? null) : null,
    notes: notesVisible(tier) ? (p.notes ?? null) : null,
    photoUrl: p.photoUrl,
    firstVisitAt: p.firstVisitAt,
    lastActivityAt: p.lastActivityAt,
    // ── People CRM Phase 1 (additive) ──
    title: showProfile ? (p.title ?? null) : null,
    phoneE164: contact.phone ? (p.phoneE164 ?? null) : null,
    whatsappE164: contact.phone ? (p.whatsappE164 ?? null) : null,
    phoneDisplay: contact.phone ? displayPhone(p) : null,
    whatsappDisplay: contact.phone ? formatPhoneDisplay(p.whatsappE164) : null,
    maritalStatus: showProfile ? (p.maritalStatus ?? null) : null,
    weddingAnniversary: showProfile ? (p.weddingAnniversary ?? null) : null,
    occupation: showProfile ? (p.occupation ?? null) : null,
    employer: showProfile ? (p.employer ?? null) : null,
    preferredChannel: showProfile ? (p.preferredChannel ?? null) : null,
    state: showProfile ? (p.state ?? null) : null,
    lga: showProfile ? (p.lga ?? null) : null,
    campusId: showProfile ? (p.homeCampusId ?? null) : null,
    membershipDate: showProfile ? (p.membershipDate ?? null) : null,
    salvationDate: showProfile ? (p.salvationDate ?? null) : null,
    baptismDate: showProfile ? (p.baptismDate ?? null) : null,
    source: showProfile ? (p.source ?? null) : null,
    lastAttendedAt: showAttendance ? (p.lastAttendedAt ?? null) : null,
    lastContactedAt: showProfile ? (p.lastContactedAt ?? null) : null,
    invitedBy: personRel(p.invitedBy),
    assignedShepherd: personRel(p.assignedShepherd),
    directoryPrivacy: showPrivacy ? parseDirectoryPrivacy(p.directoryPrivacy) : null,
    // why-fields-are-empty hints for the UI
    viewerTier: tier,
    privacyHidden,
  };
}

/** List-row serializer — core + household card + tags (existing shapes). */
export function serializePersonSummary(scope: ViewerScope, p: PersonRowLike) {
  const core = serializePersonCore(scope, p);
  const link = p.householdLinks?.[0];
  return {
    ...core,
    household: link?.household
      ? { id: link.household.id, name: link.household.name, role: link.role }
      : null,
    tags: (p.tags ?? []).map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
  };
}
